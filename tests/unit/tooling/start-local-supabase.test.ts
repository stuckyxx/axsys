import { EventEmitter } from "node:events"
import { readFileSync } from "node:fs"
import { PassThrough } from "node:stream"
import { resolve } from "node:path"
import { describe, expect, expectTypeOf, it, vi } from "vitest"
import {
  COMMAND_TIMEOUTS,
  REQUIRED_CONTAINERS,
  areRequiredContainersReady,
  executeBoundedCommand,
  formatStartupFailure,
  parseContainerState,
  probeLocalEndpoints,
  runStartWorkflow,
  waitForRequiredContainers,
  type ContainerInspection,
  type ContainerState,
  type StartRuntime,
} from "../../../scripts/start-local-supabase"

function readyContainers(): Record<string, ContainerState> {
  return Object.fromEntries(
    REQUIRED_CONTAINERS.map((name) => [
      name,
      { running: true, health: "healthy", projectId: "axsys-local" },
    ]),
  )
}

describe("local Supabase start wrapper", () => {
  it("tracks the exact required local service containers", () => {
    expect([...REQUIRED_CONTAINERS].sort()).toEqual([
      "supabase_auth_axsys-local",
      "supabase_db_axsys-local",
      "supabase_inbucket_axsys-local",
      "supabase_kong_axsys-local",
      "supabase_pg_meta_axsys-local",
      "supabase_realtime_axsys-local",
      "supabase_rest_axsys-local",
      "supabase_storage_axsys-local",
      "supabase_studio_axsys-local",
    ])
  })

  it("requires running containers and healthy checks when a healthcheck exists", () => {
    const ready = readyContainers()
    ready["supabase_rest_axsys-local"] = {
      running: true,
      health: null,
      projectId: "axsys-local",
    }
    expect(areRequiredContainersReady(ready)).toBe(true)

    expect(
      areRequiredContainersReady({
        ...ready,
        "supabase_realtime_axsys-local": {
          running: true,
          health: "starting",
          projectId: "axsys-local",
        },
      }),
    ).toBe(false)
    expect(
      areRequiredContainersReady({
        ...ready,
        "supabase_db_axsys-local": {
          running: false,
          health: "healthy",
          projectId: "axsys-local",
        },
      }),
    ).toBe(false)
    expect(
      areRequiredContainersReady({
        ...ready,
        "supabase_db_axsys-local": {
          running: true,
          health: "healthy",
          projectId: "different-project",
        },
      }),
    ).toBe(false)

    const missing = { ...ready }
    delete missing["supabase_storage_axsys-local"]
    expect(areRequiredContainersReady(missing)).toBe(false)
  })

  it("parses Docker state only when the container carries the project label", () => {
    expect(
      parseContainerState(
        '{"Status":"running","Running":true,"Health":{"Status":"healthy"}}\t"axsys-local"',
      ),
    ).toEqual({ running: true, health: "healthy", projectId: "axsys-local" })
    expect(
      parseContainerState('{"Status":"running","Running":true}\t"axsys-local"'),
    ).toEqual({
      running: true,
      health: null,
      projectId: "axsys-local",
    })
    expectTypeOf<ContainerInspection>().toEqualTypeOf<ContainerState>()
  })

  it("waits for a delayed healthy state", async () => {
    let now = 0
    let inspections = 0
    const starting = readyContainers()
    starting["supabase_storage_axsys-local"] = {
      running: true,
      health: "starting",
      projectId: "axsys-local",
    }

    await waitForRequiredContainers(
      {
        inspectContainers: () => {
          inspections += 1
          return inspections === 1 ? starting : readyContainers()
        },
        now: () => now,
        sleep: async (milliseconds) => {
          now += milliseconds
        },
      },
      { timeoutMs: 100, pollIntervalMs: 10 },
    )

    expect(inspections).toBe(2)
  })

  it("fails with a generic timeout", async () => {
    let now = 0
    await expect(
      waitForRequiredContainers(
        {
          inspectContainers: () => ({}),
          now: () => now,
          sleep: async (milliseconds) => {
            now += milliseconds
          },
        },
        { timeoutMs: 20, pollIntervalMs: 10 },
      ),
    ).rejects.toThrow("Local Supabase startup failed")
  })

  it("validates status and probes only after health succeeds", async () => {
    const events: string[] = []
    const runtime: StartRuntime = {
      startStack: () => {
        events.push("start")
      },
      inspectContainers: () => {
        events.push("inspect")
        return readyContainers()
      },
      validateStatus: () => {
        events.push("status")
      },
      probeEndpoints: async () => {
        events.push("probes")
      },
      stopStack: () => {
        events.push("stop")
      },
      now: () => 0,
      sleep: async () => {},
    }

    await runStartWorkflow(runtime, { timeoutMs: 100, pollIntervalMs: 10 })

    expect(events).toEqual(["start", "inspect", "status", "probes"])
  })

  it("stops while preserving local data and redacts any startup failure", async () => {
    const sensitiveError = new Error(
      "failed for postgresql://user:credential@127.0.0.1:54322/postgres",
    )
    const stopStack = vi.fn()
    const runtime: StartRuntime = {
      startStack: () => {
        throw sensitiveError
      },
      inspectContainers: () => ({}),
      validateStatus: () => {},
      probeEndpoints: async () => {},
      stopStack,
      now: () => 0,
      sleep: async () => {},
    }

    let thrown: unknown
    try {
      await runStartWorkflow(runtime)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toEqual(new Error("Local Supabase startup failed"))
    expect(String(thrown)).not.toContain("credential")
    expect(stopStack).toHaveBeenCalledOnce()
    expect(formatStartupFailure(sensitiveError)).toBe("Local Supabase startup failed.\n")

    const source = readFileSync(resolve("scripts/start-local-supabase.ts"), "utf8")
    expect(source).toContain(
      '["supabase", "stop", "--project-id", "axsys-local"]',
    )
    expect(source).not.toContain('"--no-backup"')
    expect(source).toContain(
      '["supabase", "start", "--ignore-health-check", "--exclude", "edge-runtime,imgproxy"]',
    )
    expect(source).toContain('["supabase", "status", "-o", "json"]')
  })

  it("gives every subprocess a finite timeout and kills the detached process group", async () => {
    for (const [kind, timeout] of Object.entries(COMMAND_TIMEOUTS)) {
      expect(timeout, kind).toBeGreaterThan(0)
      expect(timeout, kind).toBeLessThanOrEqual(10 * 60 * 1000)
    }

    const child = Object.assign(new EventEmitter(), {
      pid: 4242,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => true),
    })
    let triggerTimeout: (() => void) | undefined
    const spawnCommand = vi.fn(() => child)
    const killProcessGroup = vi.fn()
    const result = executeBoundedCommand(
      "docker",
      ["inspect", "container"],
      COMMAND_TIMEOUTS.inspect,
      {
        spawnCommand,
        killProcessGroup,
        setTimer: (callback) => {
          triggerTimeout = callback
          return 1
        },
        clearTimer: vi.fn(),
      },
    )

    expect(spawnCommand).toHaveBeenCalledWith(
      "docker",
      ["inspect", "container"],
      expect.objectContaining({
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    )
    triggerTimeout?.()
    await expect(result).rejects.toEqual(new Error("Local Supabase startup failed"))
    expect(killProcessGroup).toHaveBeenCalledWith(4242, "SIGKILL")

    const source = readFileSync(resolve("scripts/start-local-supabase.ts"), "utf8")
    for (const kind of ["start", "inspect", "status", "stop"] as const) {
      expect(source).toContain(`COMMAND_TIMEOUTS.${kind}`)
    }
  })

  it("keeps timeout cleanup bounded and returns only the generic failure", async () => {
    const timeoutError = Object.assign(
      new Error("command timed out with postgresql://user:credential@localhost/db"),
      { code: "ETIMEDOUT" },
    )
    const stopStack = vi.fn(() => {
      throw timeoutError
    })
    const runtime: StartRuntime = {
      startStack: () => {
        throw timeoutError
      },
      inspectContainers: () => ({}),
      validateStatus: () => {},
      probeEndpoints: async () => {},
      stopStack,
      now: () => 0,
      sleep: async () => {},
    }

    await expect(runStartWorkflow(runtime)).rejects.toEqual(
      new Error("Local Supabase startup failed"),
    )
    expect(stopStack).toHaveBeenCalledOnce()
  })

  it("probes auth, REST, Realtime, storage, Studio, and Mailpit without reading bodies", async () => {
    const requested: Array<{ url: string; method: string }> = []
    const fetchImplementation = vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = String(input)
      requested.push({ url, method: init?.method ?? "GET" })
      return new Response(null, { status: 200 })
    })

    await probeLocalEndpoints(fetchImplementation as typeof fetch)

    expect(requested).toEqual([
      { url: "http://127.0.0.1:54321/auth/v1/health", method: "GET" },
      { url: "http://127.0.0.1:54321/rest-admin/v1/ready", method: "HEAD" },
      { url: "http://127.0.0.1:54321/realtime/v1/api/ping", method: "HEAD" },
      { url: "http://127.0.0.1:54321/storage/v1/status", method: "GET" },
      { url: "http://127.0.0.1:54323/api/platform/profile", method: "GET" },
      { url: "http://127.0.0.1:54324/", method: "GET" },
    ])
  })

  it("routes db:start through the explicit health wrapper", () => {
    const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
      scripts: Record<string, string>
    }

    expect(packageJson.scripts["db:start"]).toBe("tsx scripts/start-local-supabase.ts")
  })
})
