const { listAll, defaultToAnArray, checkForRequired } = require('.')
const {
  clone,
  difference,
  equals,
  find,
  is,
  isNil,
  map,
  merge,
  not,
  pick,
  propEq,
  reduce
} = require('ramda')

/**
 * Format API keys
 * @param {Array} apiKeys
 * @returns {Array} - formatted API keys
 */
const formatInputApiKeys = (apiKeys) =>
  map((apiKey) => (is(String, apiKey) ? { name: apiKey } : apiKey), defaultToAnArray(apiKeys))

/**
 * Creates or updates api keys
 * @param {Object} appSync
 * @param {Object} config
 * @param {Object} state
 * @param {Function} debug
 * @returns {Array} - deployed API keys
 */
const createOrUpdateApiKeys = async (appSync, config, state, instance) => {
  const deployedApiKeys = await listAll(appSync, 'listApiKeys', { apiId: config.apiId }, 'apiKeys')

  const stateApiKeys = reduce(
    (acc, stateApiKey) => {
      const deployedApiKey = find(propEq('id', stateApiKey.id), deployedApiKeys)
      if (not(isNil(deployedApiKey))) {
        acc.push(merge(stateApiKey, deployedApiKey))
      }
      return acc
    },
    [],
    defaultToAnArray(state.apiKeys)
  )

  const apiKeysToDeploy = map((apiKey) => {
    checkForRequired(['name'], apiKey)
    const stateApiKey = find(propEq('name', apiKey.name), stateApiKeys)
    let apiKeyToDeploy
    if (isNil(stateApiKey)) {
      apiKeyToDeploy = merge(apiKey, { mode: 'create' })
    } else if (
      (not(isNil(apiKey.description)) &&
        not(equals(apiKey.description, stateApiKey.description))) ||
      (not(isNil(apiKey.expires)) && not(equals(apiKey.expires, stateApiKey.expires)))
    ) {
      apiKeyToDeploy = merge(merge(stateApiKey, { mode: 'update' }), apiKey)
    } else {
      apiKeyToDeploy = merge(merge(stateApiKey, { mode: 'ignore' }), apiKey)
    }
    return apiKeyToDeploy
  }, formatInputApiKeys(config.apiKeys))

  return Promise.all(
    map(async (apiKey) => {
      let currentApiKey = clone(apiKey)
      const dateToParse =
        is(Number, currentApiKey.expires) && currentApiKey.expires < 1000000000000
          ? currentApiKey.expires * 1000
          : currentApiKey.expires
      const expires = not(isNil(dateToParse))
        ? Math.round(new Date(dateToParse).getTime() / 1000)
        : undefined
      if (equals(currentApiKey.mode, 'create')) {
        console.log(
          `Creating api key ${currentApiKey.name}${
            not(isNil(dateToParse)) ? ` (expires ${expires})` : ''
          }`
        )
        const response = await appSync
          .createApiKey({
            apiId: config.apiId,
            description: currentApiKey.description,
            expires
          })
          .promise()
        currentApiKey = merge(currentApiKey, { id: response.apiKey.id })
      } else if (equals(currentApiKey.mode, 'update')) {
        console.log(
          `Updating api key ${currentApiKey.name}${
            not(isNil(dateToParse)) ? ` (expires ${expires})` : ''
          }`
        )
        await appSync
          .updateApiKey({
            apiId: config.apiId,
            id: currentApiKey.id,
            description: currentApiKey.description,
            expires
          })
          .promise()
      }

      return pick(['name', 'id'], currentApiKey)
    }, defaultToAnArray(apiKeysToDeploy))
  )
}

/**
 * Remove obsolete API keys
 * @param {Object} appSync
 * @param {Object} config
 * @param {Object} state
 * @param {Function} debug
 */
const removeObsoleteApiKeys = async (appSync, config, state, instance) => {
  const obsoleteApiKeys = difference(
    map(pick(['name']), defaultToAnArray(state.apiKeys)),
    map(pick(['name']), formatInputApiKeys(config.apiKeys))
  )

  await Promise.all(
    map(async ({ name }) => {
      console.log(`Removing api key ${name}`)
      const { id } = find(propEq('name', name), state.apiKeys)
      try {
        await appSync.deleteApiKey({ apiId: config.apiId, id }).promise()
      } catch (error) {
        if (not(equals(error.code, 'NotFoundException'))) {
          throw error
        }
        console.log(`Api key ${name} already removed`)
      }
    }, obsoleteApiKeys)
  )
}

module.exports = {
  createOrUpdateApiKeys,
  removeObsoleteApiKeys
}
