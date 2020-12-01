import Ajv, {SchemaObject, AnySchemaObject, AnySchema} from "ajv/dist/2019"
import type {DataValidationCxt, ValidateFunction} from "ajv/dist/types"

type SchemaVersion = "draft7" | "draft2019"

export const draft7 = getMigrate("draft7")
export const draft2019 = getMigrate("draft2019")

function getMigrateSchema(version: SchemaVersion): SchemaObject {
  return {
    $id: `migrateSchema-${version}`,
    $schema: "https://json-schema.org/draft/2019-09/schema",
    $recursiveAnchor: true,
    allOf: [{migrateSchema: version}, {$ref: "https://json-schema.org/draft/2019-09/schema"}],
  }
}

let ajv: Ajv

function getMigrate(version: SchemaVersion): (schema: AnySchemaObject) => AnySchemaObject {
  let migrate: ValidateFunction | undefined

  return (schema) => {
    ajv ||= getAjv()
    migrate ||= ajv.compile(getMigrateSchema(version))
    const valid = migrate(schema)
    schema.$schema ||= metaSchema(version)
    return {valid, errors: migrate.errors}
  }
}

function metaSchema(version: SchemaVersion): string {
  return version === "draft7"
    ? "http://json-schema.org/draft-07/schema"
    : "https://json-schema.org/draft/2019-09/schema"
}

function getAjv(): Ajv {
  ajv = new Ajv({allErrors: true})

  ajv.addKeyword({
    keyword: "migrateSchema",
    schemaType: "string",
    modifying: true,
    metaSchema: {enum: ["draft7", "draft2019"]},
    validate(
      version: SchemaVersion,
      dataSchema: AnySchema,
      _parentSchema?: AnySchemaObject,
      dataCxt?: DataValidationCxt
    ) {
      if (typeof dataSchema != "object") return true
      if (dataCxt) {
        const {parentData, parentDataProperty} = dataCxt
        const valid = constantResultSchema(dataSchema)
        if (typeof valid == "boolean") {
          parentData[parentDataProperty] = valid
          return true
        }
      }
      const dsCopy = {...dataSchema}
      for (const key in dsCopy) delete dataSchema[key]
      for (const key in dsCopy) {
        switch (key) {
          case "id": {
            const {id} = dsCopy
            if (typeof id !== "string") {
              throw new Error(`json-schema-migrate: schema id must be string`)
            }
            if (version === "draft2019" && id.includes("#")) {
              const [$id, $anchor, ...rest] = id.split("#")
              if (rest.length > 0) {
                throw new Error(`json-schema-migrate: invalid schema id ${id}`)
              }
              if ($id) dataSchema.$id = $id
              if ($anchor && $anchor !== "/") dataSchema.$anchor = $anchor
            } else {
              dataSchema.$id = id
            }
            break
          }
          case "$schema": {
            const {$schema} = dsCopy
            dataSchema.$schema =
              $schema === "http://json-schema.org/draft-04/schema#" ||
              $schema === "http://json-schema.org/draft-04/schema"
                ? metaSchema(version)
                : $schema
            break
          }
          case "definitions":
            dataSchema[version === "draft7" ? "definitions" : "$defs"] = dsCopy.definitions
            break
          case "constant":
            dataSchema.const = dsCopy.constant
            break
          case "enum":
            if (
              Array.isArray(dsCopy.enum) &&
              dsCopy.enum.length === 1 &&
              dsCopy.constant === undefined &&
              dsCopy.const === undefined
            ) {
              dataSchema.const = dsCopy.enum[0]
            } else {
              dataSchema.enum = dsCopy.enum
            }
            break
          case "exclusiveMaximum":
            migrateExclusive(dataSchema, key, "maximum")
            break
          case "exclusiveMinimum":
            migrateExclusive(dataSchema, key, "minimum")
            break
          case "maximum":
            if (dsCopy.exclusiveMaximum !== true) dataSchema.maximum = dsCopy.maximum
            break
          case "minimum":
            if (dsCopy.exclusiveMinimum !== true) dataSchema.minimum = dsCopy.minimum
            break
          case "dependencies": {
            const deps = dsCopy.dependencies
            if (version === "draft7") {
              dataSchema.dependencies = deps
            } else {
              for (const prop in deps) {
                const kwd = Array.isArray(deps[prop]) ? "dependentRequired" : "dependentSchemas"
                dataSchema[kwd] ||= {}
                dataSchema[kwd][prop] = deps[prop]
              }
            }
            break
          }
          default:
            dataSchema[key] = dsCopy[key]
        }
      }
      return true

      function migrateExclusive(schema: AnySchemaObject, key: string, limit: string): void {
        if (dsCopy[key] === true) {
          schema[key] = dsCopy[limit]
        } else if (dsCopy[key] !== false && dsCopy[key] !== undefined) {
          ajv.logger.warn(`${key} is not boolean`)
        }
      }
    },
  })
  return ajv
}

function constantResultSchema(schema: AnySchema): boolean | undefined {
  if (typeof schema == "boolean") return schema
  const keys = Object.keys(schema)
  if (keys.length === 0) return true
  if (keys.length === 1 && keys[0] === "not") {
    const valid = constantResultSchema(schema.not)
    if (typeof valid == "boolean") return !valid
  }
  return undefined
}
