const path = require('path')
const { difference, equals, find, isNil, map, merge, not, pick } = require('ramda')

const { checkForDuplicates, defaultToAnArray, equalsByKeys, listAll, readIfFile } = require('.')

/**
 * Create or update functions
 * @param {Object} appSync
 * @param {Object} config
 * @param {Function} debug
 * @return {Object} - deployed functions
 */
const createOrUpdateFunctions = async (appSync, config, instance) => {
  checkForDuplicates(['name', 'dataSource'], defaultToAnArray(config.functions))
  const deployedFunctions = await listAll(
    appSync,
    'listFunctions',
    { apiId: config.apiId },
    'functions'
  )

  const functionsWithTemplates = await Promise.all(
    map(async (func) => {
      // const requestMappingTemplate = await readIfFile(func.request)
      // const responseMappingTemplate = await readIfFile(func.response)
      const requestMappingTemplate = await readIfFile(path.join(config.src, func.request))
      const responseMappingTemplate = await readIfFile(path.join(config.src, func.request))
      return merge(func, {
        requestMappingTemplate,
        responseMappingTemplate,
        dataSourceName: func.dataSource
      })
    }, defaultToAnArray(config.functions))
  )

  const functionsToDeploy = map((func) => {
    const deployedFunction = find(
      ({ name, dataSourceName }) =>
        equals(name, func.name) && equals(dataSourceName, func.dataSourceName),
      deployedFunctions
    )
    const functionEquals = isNil(deployedFunction)
      ? false
      : equalsByKeys(
          ['dataSourceName', 'name', 'responseMappingTemplate', 'requestMappingTemplate'],
          deployedFunction,
          func
        )
    const mode = not(functionEquals) ? (not(deployedFunction) ? 'create' : 'update') : 'ignore'
    return merge(func, {
      mode,
      functionId: deployedFunction ? deployedFunction.functionId : undefined
    })
  }, functionsWithTemplates)

  return Promise.all(
    map(async (func) => {
      const params = {
        apiId: config.apiId,
        name: func.name,
        requestMappingTemplate: func.requestMappingTemplate,
        responseMappingTemplate: func.responseMappingTemplate,
        functionVersion: func.functionVersion || '2018-05-29',
        dataSourceName: func.dataSource,
        description: func.description
      }
      if (equals(func.mode, 'create')) {
        console.log(`Creating function ${func.name}`)
        const { functionConfiguration } = await appSync.createFunction(params).promise()
        func.functionId = functionConfiguration.functionId
      } else if (equals(func.mode, 'update')) {
        console.log(`Updating function ${func.name}`)
        await appSync.updateFunction(merge(params, { functionId: func.functionId })).promise()
      }
      return Promise.resolve(func)
    }, functionsToDeploy)
  )
}

/**
 * Remove obsolete functions
 * @param {Object} appSync
 * @param {Object} config
 * @param {Object} state
 * @param {Function} debug
 */
const removeObsoleteFunctions = async (appSync, config, state, instance) => {
  const obsoleteFunctions = difference(
    map(pick(['name', 'dataSource']), defaultToAnArray(state.functions)),
    map(pick(['name', 'dataSource']), defaultToAnArray(config.functions))
  )
  await Promise.all(
    map(async (func) => {
      const { functionId } = find(
        ({ name, dataSource }) => equals(name, func.name) && equals(dataSource, func.dataSource),
        state.functions
      )
      console.log(`Removing function ${func.name}`)
      try {
        await appSync
          .deleteFunction({
            apiId: config.apiId,
            functionId
          })
          .promise()
      } catch (error) {
        if (not(equals(error.code, 'NotFoundException'))) {
          throw error
        }
        console.log(`Function ${func.name} already removed`)
      }
    }, obsoleteFunctions)
  )
}

module.exports = {
  createOrUpdateFunctions,
  removeObsoleteFunctions
}
