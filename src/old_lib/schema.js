const path = require('path')
const { equals, includes, isNil, not } = require('ramda')
const { checksum, readIfFile, sleep } = require('.')

/**
 * Create schema
 * @param {Object} appSync
 * @param {Object} config
 * @param {Object} state
 * @param {Function} debug
 * @return {Object} - schema checksum
 */
const createSchema = async (appSync, config, state) => {
  let { schema } = config
  if (isNil(schema)) {
    if (not(config.isApiCreator)) {
      console.log('Schema not defined, ignoring create/update')
      return Promise.resolve()
    }
    console.log('Schema not defined, using schema.graphql')
    schema = 'schema.graphql'
  }
  console.log(path.join(config.src, schema))
  schema = await readIfFile(path.join(config.src, schema))

  const schemaChecksum = checksum(schema)
  if (not(equals(schemaChecksum, state.schemaChecksum))) {
    console.log(`Create a schema for ${config.apiId}`)
    await appSync
      .startSchemaCreation({
        apiId: config.apiId,
        definition: Buffer.from(schema)
      })
      .promise()
    let waiting = true
    do {
      const { status } = await appSync.getSchemaCreationStatus({ apiId: config.apiId }).promise()
      console.log(`Schema creation status ${status} for ${config.apiId}`)
      if (includes(status, ['FAILED', 'SUCCESS', 'NOT_APPLICABLE'])) {
        waiting = false
      } else {
        await sleep(1000)
      }
    } while (waiting)
  }
  return schemaChecksum
}

module.exports = {
  createSchema
}
