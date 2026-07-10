import { spawn } from "node:child_process"
import { resolve } from "node:path"
import type { Readable } from "node:stream"
import { pathToFileURL } from "node:url"

export const REQUIRED_CONTAINERS = [
  "supabase_db_axsys-local",
  "supabase_auth_axsys-local",
  "supabase_kong_axsys-local",
  "supabase_inbucket_axsys-local",
  "supabase_realtime_axsys-local",
  "supabase_rest_axsys-local",
  "supabase_storage_axsys-local",
  "supabase_pg_meta_axsys-local",
  "supabase_studio_axsys-local",
] as const

export type ContainerInspection = {
  running: boolean
  health: string | null
  projectId: string | null
}

export type ContainerState = ContainerInspection

type Awaitable<T> = T | Promise<T>

type WaitDependencies = {
  inspectContainers: () => Awaitable<Record<string, ContainerState>>
  now: () => number
  sleep: (milliseconds: number) => Promise<void>
}

export type StartRuntime = WaitDependencies & {
  startStack: () => Awaitable<void>
  validateStatus: () => Awaitable<void>
  probeEndpoints: () => Promise<void>
  stopStack: () => Awaitable<void>
}

type WaitOptions = {
  timeoutMs: number
  pollIntervalMs: number
}

const START_FAILURE = "Local Supabase startup failed"
export const COMMAND_TIMEOUTS = {
  start: 10 * 60 * 1000,
  inspect: 10_000,
  status: 30_000,
  stop: 60_000,
} as const
const DEFAULT_WAIT_OPTIONS: WaitOptions = {
  timeoutMs: 5 * 60 * 1000,
  pollIntervalMs: 2_000,
}

export function parseContainerState(text: string): ContainerState {
  const separatorIndex = text.lastIndexOf("\t")
  if (separatorIndex < 0) {
    throw new Error(START_FAILURE)
  }
  const state = JSON.parse(text.slice(0, separatorIndex)) as {
    Running?: unknown
    Health?: { Status?: unknown }
  }
  const projectId = JSON.parse(text.slice(separatorIndex + 1)) as unknown
  if (typeof state.Running !== "boolean") {
    throw new Error(START_FAILURE)
  }
  return {
    running: state.Running,
    health:
      typeof state.Health?.Status === "string" ? state.Health.Status : null,
    projectId: typeof projectId === "string" ? projectId : null,
  }
}

export function areRequiredContainersReady(
  states: Readonly<Record<string, ContainerState>>,
): boolean {
  return REQUIRED_CONTAINERS.every((name) => {
    const state = states[name]
    return Boolean(
      state?.running &&
        state.projectId === "axsys-local" &&
        (state.health === null || state.health === "healthy"),
    )
  })
}

export async function waitForRequiredContainers(
  dependencies: WaitDependencies,
  options: WaitOptions = DEFAULT_WAIT_OPTIONS,
): Promise<void> {
  const deadline = dependencies.now() + options.timeoutMs

  while (true) {
    if (areRequiredContainersReady(await dependencies.inspectContainers())) {
      return
    }
    if (dependencies.now() >= deadline) {
      throw new Error(START_FAILURE)
    }
    await dependencies.sleep(options.pollIntervalMs)
  }
}

export async function probeLocalEndpoints(
  fetchImplementation: typeof fetch = fetch,
): Promise<void> {
  const probes: ReadonlyArray<{
    url: string
    method?: "GET" | "HEAD"
    acceptedStatuses: readonly number[]
  }> = [
    {
      url: "http://127.0.0.1:54321/auth/v1/health",
      acceptedStatuses: [200],
    },
    {
      url: "http://127.0.0.1:54321/rest-admin/v1/ready",
      method: "HEAD",
      acceptedStatuses: [200],
    },
    {
      url: "http://127.0.0.1:54321/realtime/v1/api/ping",
      method: "HEAD",
      acceptedStatuses: [200],
    },
    {
      url: "http://127.0.0.1:54321/storage/v1/status",
      acceptedStatuses: [200],
    },
    {
      url: "http://127.0.0.1:54323/api/platform/profile",
      acceptedStatuses: [200],
    },
    {
      url: "http://127.0.0.1:54324/",
      acceptedStatuses: [200],
    },
  ]

  for (const probe of probes) {
    const response = await fetchImplementation(probe.url, {
      method: probe.method,
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    })
    if (!probe.acceptedStatuses.includes(response.status)) {
      throw new Error(START_FAILURE)
    }
  }
}

export function formatStartupFailure(error: unknown): string {
  void error
  return `${START_FAILURE}.\n`
}

export async function runStartWorkflow(
  runtime: StartRuntime,
  options: WaitOptions = DEFAULT_WAIT_OPTIONS,
): Promise<void> {
  try {
    await runtime.startStack()
    await waitForRequiredContainers(runtime, options)
    await runtime.validateStatus()
    await runtime.probeEndpoints()
  } catch (error) {
    try {
      await runtime.stopStack()
    } catch {
      // Cleanup is best-effort; the outward error remains fixed and credential-free.
    }
    void error
    throw new Error(START_FAILURE)
  }
}

interface SpawnedCommand {
  pid?: number
  stdout: Pick<Readable, "destroy" | "on">
  stderr: Pick<Readable, "destroy" | "resume">
  once(event: "error", listener: (error: Error) => void): unknown
  once(
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown
  kill: (signal: NodeJS.Signals) => boolean
}

type SpawnCommand = (
  command: string,
  args: string[],
  options: {
    detached: true
    stdio: ["ignore", "pipe", "pipe"]
  },
) => SpawnedCommand

export type BoundedCommandRuntime = {
  spawnCommand: SpawnCommand
  killProcessGroup: (processId: number, signal: NodeJS.Signals) => void
  setTimer: (callback: () => void, milliseconds: number) => unknown
  clearTimer: (handle: unknown) => void
}

const realCommandRuntime: BoundedCommandRuntime = {
  spawnCommand(command, args, options) {
    return spawn(command, args, options) as SpawnedCommand
  },
  killProcessGroup(processId, signal) {
    process.kill(-processId, signal)
  },
  setTimer(callback, milliseconds) {
    return setTimeout(callback, milliseconds)
  },
  clearTimer(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>)
  },
}

export async function executeBoundedCommand(
  command: string,
  args: readonly string[],
  timeout: number,
  runtime: BoundedCommandRuntime = realCommandRuntime,
): Promise<string> {
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error(START_FAILURE)
  }

  let child: SpawnedCommand
  try {
    child = runtime.spawnCommand(command, [...args], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
  } catch {
    throw new Error(START_FAILURE)
  }

  return new Promise<string>((resolveCommand, rejectCommand) => {
    const chunks: Buffer[] = []
    let outputBytes = 0
    let settled = false
    const timer = { handle: undefined as unknown }

    const clearCommandTimer = () => {
      if (timer.handle !== undefined) runtime.clearTimer(timer.handle)
    }
    const finishWithFailure = () => {
      if (settled) return
      settled = true
      clearCommandTimer()
      child.stdout.destroy()
      child.stderr.destroy()
      rejectCommand(new Error(START_FAILURE))
    }
    const terminateProcessGroup = () => {
      if (child.pid === undefined) {
        try {
          child.kill("SIGKILL")
        } catch {
          // The process may have exited between the timeout and termination.
        }
        return
      }
      try {
        runtime.killProcessGroup(child.pid, "SIGKILL")
      } catch {
        try {
          child.kill("SIGKILL")
        } catch {
          // The process group may already be gone.
        }
      }
    }

    child.stdout.on("data", (chunk: Buffer | string) => {
      if (settled) return
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      outputBytes += buffer.length
      if (outputBytes > 16 * 1024 * 1024) {
        terminateProcessGroup()
        finishWithFailure()
        return
      }
      chunks.push(buffer)
    })
    child.stderr.resume()
    child.once("error", finishWithFailure)
    child.once("close", (code: number | null) => {
      if (settled) return
      settled = true
      clearCommandTimer()
      if (code !== 0) {
        rejectCommand(new Error(START_FAILURE))
        return
      }
      resolveCommand(Buffer.concat(chunks).toString("utf8"))
    })

    timer.handle = runtime.setTimer(() => {
      terminateProcessGroup()
      finishWithFailure()
    }, timeout)
  })
}

const realRuntime: StartRuntime = {
  async startStack() {
    await executeBoundedCommand(
      "npx",
      ["supabase", "start", "--ignore-health-check", "--exclude", "edge-runtime,imgproxy"],
      COMMAND_TIMEOUTS.start,
    )
  },

  async inspectContainers() {
    const inspected = await Promise.all(
      REQUIRED_CONTAINERS.map(async (name) => {
        try {
          const output = await executeBoundedCommand(
            "docker",
            [
              "inspect",
              "--format",
              '{{json .State}}\t{{json (index .Config.Labels "com.supabase.cli.project")}}',
              name,
            ],
            COMMAND_TIMEOUTS.inspect,
          )
          return [name, parseContainerState(output.trim())] as const
        } catch {
          return null
        }
      }),
    )
    return Object.fromEntries(inspected.filter((entry) => entry !== null))
  },

  async validateStatus() {
    await executeBoundedCommand(
      "npx",
      ["supabase", "status", "-o", "json"],
      COMMAND_TIMEOUTS.status,
    )
  },

  probeEndpoints() {
    return probeLocalEndpoints()
  },

  async stopStack() {
    await executeBoundedCommand(
      "npx",
      ["supabase", "stop", "--project-id", "axsys-local"],
      COMMAND_TIMEOUTS.stop,
    )
  },

  now: Date.now,

  sleep(milliseconds) {
    return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds))
  },
}

const entryPoint = process.argv[1]
if (entryPoint && import.meta.url === pathToFileURL(resolve(entryPoint)).href) {
  runStartWorkflow(realRuntime)
    .then(() => {
      process.stdout.write("Local Supabase stack is healthy.\n")
    })
    .catch((error: unknown) => {
      process.stderr.write(formatStartupFailure(error))
      process.exitCode = 1
    })
}
