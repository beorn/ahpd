/**
 * The daemon's helper that holds the machine's idle sleep, VS Code's
 * `AgentHostPowerSaveBlocker`.
 *
 * One child process per hold: `caffeinate` on macOS, `systemd-inhibit` on
 * Linux, and PowerShell's `SetThreadExecutionState` on Windows. Each lets go
 * when the daemon dies too: `caffeinate` watches the daemon's pid, and the
 * other two end at the end of their input. Without `allowOnBattery`, the hold
 * is taken only on mains power, checked every 30 s, and a power source this
 * host cannot read allows sleep.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/agentHostPowerSaveBlocker.ts
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { KeepAwakeHold } from '@ahpd/sdk';

const execFileAsync = promisify(execFile);

/** What a platform gives the blocker: its helper and its power source. */
export interface PowerBackend {
  start(allowOnBattery: boolean): ChildProcess;
  isOnBatteryPower(): Promise<boolean>;
  /** Whether the helper is killed at release; `caffeinate` ignores its input. */
  readonly killOnDispose: boolean;
}

/** What the blocker says, at the levels the daemon's log has. */
export interface PowerLog {
  warn(message: string): void;
  debug(message: string): void;
}

/** One Linux power supply, as `/sys/class/power_supply` describes it. */
export interface LinuxPowerSupply {
  readonly type: string;
  readonly scope?: string | undefined;
  readonly online?: string | undefined;
  readonly status?: string | undefined;
}

/**
 * A log that says each kind of warning once for the daemon's life, so a host
 * that cannot hold, such as a server with no power supply readings, says so
 * at its first hold and not at every hold after it.
 */
export const oncePerProcess = (log: PowerLog): PowerLog => {
  const said = new Set<string>();
  return {
    warn: (message) => {
      const kind = message.split(':').slice(0, 2).join(':');
      if (said.has(kind)) return;
      said.add(kind);
      log.warn(message);
    },
    debug: (message) => { log.debug(message); },
  };
};

const linePowerSupplyTypes = new Set(['Mains', 'USB', 'USB_C', 'USB_PD', 'USB_PD_DRP', 'Wireless', 'UPS']);

/** How often the power source is read again. */
const POLL_MS = 30_000;

/**
 * Holds idle sleep until `release`, as one child process, started again when
 * the power source allows it again. A helper that fails is logged once.
 */
export const holdIdleSleep = (allowOnBattery: boolean, log: PowerLog, backend: PowerBackend = nativePowerBackend): KeepAwakeHold => {
  let disposed = false;
  let child: { release(): void } | undefined;
  let poll: ReturnType<typeof setTimeout> | undefined;
  let warned = false;
  const warnOnce = (message: string): void => {
    if (warned) return;
    warned = true;
    log.warn(message);
  };
  const clear = (): void => {
    child?.release();
    child = undefined;
  };
  const start = (): { release(): void } => {
    const helper = backend.start(allowOnBattery);
    let gone = false;
    let stderr = '';
    helper.stdout?.once('data', () => { log.debug('keep-awake: the idle sleep helper is ready'); });
    helper.stderr?.on('data', (data: Buffer) => { stderr = (stderr + data.toString()).slice(-4096); });
    helper.on('error', (error) => { if (!gone) warnOnce(`keep-awake: cannot start the idle sleep helper: ${error.message}`); });
    helper.on('close', (code, signal) => {
      if (gone) return;
      warnOnce(`keep-awake: the idle sleep helper exited (${String(code ?? signal)}): ${stderr.trim()}`);
      child = undefined;
    });
    helper.stdin?.on('error', (error) => {
      if (gone) return;
      warnOnce(`keep-awake: the idle sleep helper's input failed: ${error.message}`);
      child = undefined;
    });
    return {
      release: () => {
        gone = true;
        helper.stdin?.end();
        if (backend.killOnDispose) helper.kill();
      },
    };
  };
  const update = async (): Promise<void> => {
    try {
      // The Windows helper reads its own power source, so PowerShell starts once.
      const allowed = allowOnBattery || !await backend.isOnBatteryPower();
      if (disposed) return;
      if (!allowed) clear();
      else child ??= start();
    }
    catch (error) {
      if (disposed) return;
      clear();
      warnOnce(`keep-awake: cannot inhibit idle sleep on this host: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!disposed) {
      poll = setTimeout(() => { void update(); }, POLL_MS);
      poll.unref?.();
    }
  };
  void update();
  return {
    release: () => {
      disposed = true;
      if (poll !== undefined) clearTimeout(poll);
      clear();
    },
  };
};

/** The helper for this platform. */
export const startNativePowerSaveBlocker = (allowOnBattery: boolean): ChildProcess => {
  if (process.platform === 'darwin')
    return spawn('/usr/bin/caffeinate', ['-i', '-w', String(process.pid)], { stdio: ['pipe', 'ignore', 'pipe'] });
  if (process.platform === 'linux') {
    // Piped input keeps polkit from prompting, and its end releases the inhibitor.
    return spawn('systemd-inhibit', ['--what=idle', '--mode=block', '--who=ahpd', '--why=An agent is working', 'cat'], { stdio: ['pipe', 'ignore', 'pipe'] });
  }
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot;
    if (!systemRoot) throw new Error('SystemRoot is not set');
    return spawn(join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      `${windowsPowerSaveBlockerScript}\n[AgentHostPowerSaveBlocker]::Run($${String(allowOnBattery)})`,
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  }
  throw new Error('Idle sleep inhibition is not supported on this platform');
};

const readOptionalFile = async (path: string): Promise<string | undefined> => {
  try {
    return (await readFile(path, 'utf8')).trim();
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
};

/** Whether the host runs on battery, from Linux's power supply readings; throws where it cannot tell. */
export const isOnBatteryPowerFromLinuxSupplies = (supplies: readonly LinuxPowerSupply[]): boolean => {
  let hasOfflineLinePower = false;
  let hasDischargingBattery = false;
  for (const supply of supplies) {
    if (supply.scope === 'Device') continue;
    if (linePowerSupplyTypes.has(supply.type)) {
      if (supply.online === '1') return false;
      if (supply.online === '0') hasOfflineLinePower = true;
    }
    else if (supply.type === 'Battery' && supply.status === 'Discharging') {
      hasDischargingBattery = true;
    }
  }
  if (hasOfflineLinePower || hasDischargingBattery) return true;
  throw new Error('Power source is unknown');
};

const isOnBatteryPower = async (): Promise<boolean> => {
  if (process.platform === 'darwin') {
    const { stdout } = await execFileAsync('/usr/bin/pmset', ['-g', 'batt'], { timeout: 5000 });
    if (stdout.includes('\'Battery Power\'')) return true;
    if (stdout.includes('\'AC Power\'')) return false;
    throw new Error('pmset did not report a power source');
  }
  if (process.platform === 'linux') {
    const supplyRoot = '/sys/class/power_supply';
    const supplies: LinuxPowerSupply[] = [];
    for (const entry of await readdir(supplyRoot)) {
      const path = join(supplyRoot, entry);
      const type = await readOptionalFile(join(path, 'type'));
      if (!type) continue;
      const scope = await readOptionalFile(join(path, 'scope'));
      if (scope === 'Device') continue;
      if (linePowerSupplyTypes.has(type)) supplies.push({ type, scope, online: await readOptionalFile(join(path, 'online')) });
      else if (type === 'Battery') supplies.push({ type, scope, status: await readOptionalFile(join(path, 'status')) });
    }
    return isOnBatteryPowerFromLinuxSupplies(supplies);
  }
  throw new Error('Power source detection is not supported on this platform');
};

const nativePowerBackend: PowerBackend = {
  start: startNativePowerSaveBlocker,
  isOnBatteryPower: async () => process.platform !== 'win32' && await isOnBatteryPower(),
  killOnDispose: process.platform === 'darwin',
};

/*
 * The native call on one thread. ES_SYSTEM_REQUIRED inhibits idle system
 * sleep without keeping the display on or overriding an explicit sleep request.
 */
const windowsPowerSaveBlockerScript = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class AgentHostPowerSaveBlocker {
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern uint SetThreadExecutionState(uint flags);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetSystemPowerStatus(out PowerStatus status);
  [StructLayout(LayoutKind.Sequential)]
  struct PowerStatus {
    public byte ACLineStatus, BatteryFlag, BatteryLifePercent, SystemStatusFlag;
    public uint BatteryLifeTime, BatteryFullLifeTime;
  }
  public static void Run(bool allowOnBattery) {
    const uint continuous = 0x80000000;
    bool holding = false;
    bool ready = false;
    // Console.In can implement ReadLineAsync synchronously on Windows PowerShell.
    var input = System.Threading.Tasks.Task.Run(() => Console.OpenStandardInput().ReadByte());
    try {
      do {
        bool allowed = allowOnBattery;
        if (!allowOnBattery) {
          PowerStatus status;
          if (!GetSystemPowerStatus(out status)) {
            throw new Win32Exception(Marshal.GetLastWin32Error());
          }
          bool noBattery = status.BatteryFlag != 255 && (status.BatteryFlag & 128) != 0;
          if (status.ACLineStatus == 255 && !noBattery) {
            throw new InvalidOperationException("Unknown power source");
          }
          allowed = status.ACLineStatus == 1 || noBattery;
        }
        if (allowed != holding) {
          if (SetThreadExecutionState(continuous | (allowed ? 1u : 0u)) == 0) {
            throw new Win32Exception(Marshal.GetLastWin32Error());
          }
          holding = allowed;
        }
        if (!ready) {
          Console.WriteLine("ready");
          ready = true;
        }
      } while (!input.Wait(15000));
    } finally {
      if (holding && SetThreadExecutionState(continuous) == 0) {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }
    }
  }
}
'@
`;
