import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
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

type WaitDependencies = {
  inspectContainers: () => Record<string, ContainerState>
  now: () => number
  sleep: (milliseconds: number) => Promise<void>
}

export type StartRuntime = WaitDependencies & {
  startStack: () => void
  validateStatus: () => void
  probeEndpoints: () => Promise<void>
  stopStack: () => void
}

type WaitOptions = {
  timeoutMs: number
  pollIntervalMs: number
}

const START_FAILURE = "Local Supabase startup failed"
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
    if (areRequiredContainersReady(dependencies.inspectContainers())) {
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
    runtime.startStack()
    await waitForRequiredContainers(runtime, options)
    runtime.validateStatus()
    await runtime.probeEndpoints()
  } catch (error) {
    try {
      runtime.stopStack()
    } catch {
      // Cleanup is best-effort; the outward error remains fixed and credential-free.
    }
    void error
    throw new Error(START_FAILURE)
  }
}

function quietExec(command: string, args: readonly string[]): string {
  return execFileSync(command, [...args], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  })
}

const realRuntime: StartRuntime = {
  startStack() {
    quietExec("npx", ["supabase", "start", "--ignore-health-check", "--exclude", "edge-runtime,imgproxy"])
  },

  inspectContainers() {
    const states: Record<string, ContainerState> = {}
    for (const name of REQUIRED_CONTAINERS) {
      try {
        const output = quietExec("docker", [
          "inspect",
          "--format",
          '{{json .State}}\t{{json (index .Config.Labels "com.supabase.cli.project")}}',
          name,
        ])
        states[name] = parseContainerState(output.trim())
      } catch {
        // A container can be absent briefly while the CLI creates the stack.
      }
    }
    return states
  },

  validateStatus() {
    quietExec("npx", ["supabase", "status", "-o", "json"])
  },

  probeEndpoints() {
    return probeLocalEndpoints()
  },

  stopStack() {
    quietExec("npx", ["supabase", "stop", "--project-id", "axsys-local"])
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
