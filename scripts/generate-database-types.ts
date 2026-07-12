import { randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import { existsSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const OUTPUT_PATH = join("src", "lib", "supabase", "database.types.ts")

const GENERATED_COLUMNS = [
  { table: "company_settings", column: "consolidated_address" },
] as const

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
}

function uniqueOffset(source: string, token: string, label: string): number {
  const first = source.indexOf(token)
  const second = first === -1 ? -1 : source.indexOf(token, first + token.length)

  if (first === -1 || second !== -1) {
    throw new Error(`Expected exactly one generated type marker for ${label}`)
  }

  return first
}

function rewriteGeneratedColumn(
  source: string,
  table: string,
  shape: "Insert" | "Update",
  column: string,
): string {
  const tableToken = `      ${table}: {\n`
  const tableStart = uniqueOffset(source, tableToken, table)
  const afterTableStart = tableStart + tableToken.length
  const nextTable = source.slice(afterTableStart).search(/^      [A-Za-z0-9_]+: \{$/mu)
  const tableEnd = nextTable === -1 ? source.length : afterTableStart + nextTable
  const tableBlock = source.slice(tableStart, tableEnd)
  const shapeToken = `        ${shape}: {\n`
  const shapeStartInTable = uniqueOffset(tableBlock, shapeToken, `${table}.${shape}`)
  const afterShapeStart = shapeStartInTable + shapeToken.length
  const nextShape = tableBlock.slice(afterShapeStart).search(/^        [A-Za-z]+: /mu)

  if (nextShape === -1) {
    throw new Error(`Expected a closing generated type marker for ${table}.${shape}`)
  }

  const shapeEndInTable = afterShapeStart + nextShape
  const shapeBlock = tableBlock.slice(shapeStartInTable, shapeEndInTable)
  const columnPattern = new RegExp(
    `^          ${escapeRegExp(column)}\\??: [^\\n]+$`,
    "gmu",
  )
  const matches = [...shapeBlock.matchAll(columnPattern)]

  if (matches.length !== 1) {
    throw new Error(`Expected exactly one generated field for ${table}.${shape}.${column}`)
  }

  const match = matches[0]!
  const absoluteStart = tableStart + shapeStartInTable + match.index
  return (
    source.slice(0, absoluteStart) +
    `          ${column}?: never` +
    source.slice(absoluteStart + match[0].length)
  )
}

export function postprocessDatabaseTypes(generatedSource: string): string {
  if (!generatedSource.trim()) {
    throw new Error("Supabase generated an empty database type contract")
  }

  let processed = generatedSource.replace(/\r\n/gu, "\n")
  for (const { table, column } of GENERATED_COLUMNS) {
    processed = rewriteGeneratedColumn(processed, table, "Insert", column)
    processed = rewriteGeneratedColumn(processed, table, "Update", column)
  }

  return `${processed.trimEnd()}\n`
}

export function writeDatabaseTypesAtomically(
  destination: string,
  contents: string,
): void {
  const temporaryPath = join(
    dirname(destination),
    `.${destination.split("/").at(-1)}.${process.pid}.${randomUUID()}.tmp`,
  )

  try {
    writeFileSync(temporaryPath, contents, { encoding: "utf8", flag: "wx", mode: 0o644 })
    renameSync(temporaryPath, destination)
  } finally {
    if (existsSync(temporaryPath)) {
      rmSync(temporaryPath, { force: true })
    }
  }
}

export function generateDatabaseTypes(cwd = process.cwd()): void {
  const executable = join(
    cwd,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "supabase.cmd" : "supabase",
  )
  const result = spawnSync(
    executable,
    ["gen", "types", "typescript", "--local", "--schema", "public"],
    { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  )

  if (result.stderr) {
    process.stderr.write(result.stderr)
  }
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`Supabase type generation exited with status ${result.status ?? "unknown"}`)
  }

  const processed = postprocessDatabaseTypes(result.stdout)
  writeDatabaseTypesAtomically(resolve(cwd, OUTPUT_PATH), processed)
}

const entryPoint = process.argv[1]
if (entryPoint && import.meta.url === pathToFileURL(resolve(entryPoint)).href) {
  try {
    generateDatabaseTypes()
    process.stdout.write("Database types generated and GENERATED ALWAYS columns locked.\n")
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown failure"
    process.stderr.write(`Database type generation failed: ${message}\n`)
    process.exitCode = 1
  }
}
