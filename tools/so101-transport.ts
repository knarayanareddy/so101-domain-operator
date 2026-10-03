/**
 * Node serialport transport for the SO-101 Control Room.
 *
 * The driver stack (feetech.ts / kinematics.ts / arm.ts / missions.ts) has zero DOM
 * dependencies and talks to hardware through the 4-method `Transport` seam:
 *
 *     write(bytes)  read(timeoutMs)  flush()  close()
 *
 * The browser build satisfies that seam with Web Serial. This file satisfies it with
 * `serialport` instead, so the exact same ServoBus + Arm + Runner code that ships in the
 * UI can be driven headless — from a terminal, a script, or an agent — with no browser.
 *
 * This is what makes "an agent operates the arms" possible: it is not a re-implementation,
 * it is the same code through a different pipe.
 */
import type { Transport } from "../src/lib/feetech";

export interface SerialPortInfo {
  path: string;
  manufacturer?: string;
  vendorId?: string;
  productId?: string;
  serialNumber?: string;
}

/** Known USB-serial chips. macOS 11+ ships in-kernel DriverKit drivers for all of these,
 *  so none of them need a third-party driver install (and none need sudo). */
const KNOWN_CHIPS: Record<string, string> = {
  "0403": "FTDI (FT232/FT2232/FT4232) — in-kernel driver: com.apple.DriverKit-AppleUSBFTDI",
  "10c4": "Silicon Labs CP210x — in-kernel driver: com.apple.DriverKit-AppleUSBCHCOM",
  "067b": "Prolific PL2303 — in-kernel driver: com.apple.DriverKit-AppleUSBPLCOM",
  "1a86": "WCH CH340/CH341 — in-kernel driver: com.apple.DriverKit-AppleUSBCHCOM",
};

const hex = (v: unknown) =>
  typeof v === "number" ? v.toString(16).padStart(4, "0") : String(v ?? "").toLowerCase();

/** List candidate ports with a plain-language verdict on whether macOS will drive them. */
export async function listCandidatePorts(): Promise<SerialPortInfo[]> {
  const { SerialPort } = await import("serialport");
  // serialport >=12 exposes SerialPort.list(); older builds used SerialPort.lister.list().
  const anySp = SerialPort as unknown as { list?: () => Promise<SerialPortInfo[]>; lister?: { list(): Promise<SerialPortInfo[]> } };
  const list = anySp.list ? () => anySp.list!() : () => anySp.lister!.list();
  const ports = await list();
  return ports.map((p) => {
    const vid = hex(p.vendorId);
    return {
      path: p.path,
      manufacturer: p.manufacturer,
      vendorId: vid,
      productId: hex(p.productId),
      serialNumber: p.serialNumber,
      chip: KNOWN_CHIPS[vid] ?? "UNKNOWN vendor — macOS may need a driver",
    } as SerialPortInfo & { chip: string };
  });
}

export class NodeSerialTransport implements Transport {
  private rx: number[] = [];
  private waiters: (() => void)[] = [];
  private closed = false;

  private constructor(private readonly port: any) {}

  static async open(path: string, baudRate = 1_000_000): Promise<NodeSerialTransport> {
    const { SerialPort } = await import("serialport");
    const port = new SerialPort({ path, baudRate, autoOpen: false });
    await new Promise<void>((resolve, reject) =>
      port.open((err: Error | null) => (err ? reject(err) : resolve())),
    );
    const t = new NodeSerialTransport(port);
    port.on("data", (chunk: Buffer) => {
      for (let i = 0; i < chunk.length; i++) t.rx.push(chunk[i]);
      // keep the buffer bounded: a wedged bus must not grow memory without limit
      if (t.rx.length > 8192) t.rx.splice(0, t.rx.length - 8192);
      const w = t.waiters;
      t.waiters = [];
      w.forEach((f) => f());
    });
    port.on("close", () => {
      t.closed = true;
      t.waiters.forEach((f) => f());
    });
    port.on("error", (e: Error) => {
      // unplugged / permission denied — surface via read() timeout path + isOpen
      t.closed = true;
      t.waiters.forEach((f) => f());
      void e;
    });
    return t;
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  async write(data: Uint8Array): Promise<void> {
    if (this.closed) throw new Error(`serial port closed (unplugged?): ${data.length} bytes dropped`);
    await new Promise<void>((resolve, reject) =>
      this.port.write(data, (err: Error | null) => (err ? reject(err) : resolve())),
    );
  }

  /** Wait up to timeoutMs for bytes. Returns whatever arrived (possibly empty). */
  async read(timeoutMs: number): Promise<number[]> {
    if (!this.rx.length && !this.closed) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    const out = this.rx;
    this.rx = [];
    return out;
  }

  async flush(): Promise<void> {
    this.rx = [];
  }

  async close(): Promise<void> {
    this.closed = true;
    try {
      await new Promise<void>((r) => this.port.close(() => r()));
    } catch {
      /* already gone */
    }
  }
}
