const { Component } = require('@serverless/core')
const { isNil, mergeDeepRight, pick, map, merge, not } = require('ramda')

const {
  getClients,
  createSchema,
  createServiceRole,
  createOrUpdateGraphqlApi,
  createOrUpdateDataSources,
  createOrUpdateResolvers,
  createOrUpdateFunctions,
  createOrUpdateApiKeys,
  removeObsoleteDataSources,
  removeObsoleteResolvers,
  removeObsoleteFunctions,
  removeObsoleteApiKeys,
  deleteGraphqlApi
} = require('./utils')

const defaults = {
  region: 'us-east-1'
}

class AwsAppSync extends Component {
  async default(inputs = {}) {
    const config = mergeDeepRight(merge(defaults, { apiId: this.state.apiId }), inputs)
    const { appSync } = getClients(this.context.credentials.aws, config.region)
    const graphqlApi = await createOrUpdateGraphqlApi(appSync, config, this.context.debug)
    config.apiId = graphqlApi.apiId
    config.arn = graphqlApi.arn
    config.uris = graphqlApi.uris

    const awsIamRole = await this.load('@serverless/aws-iam-role')
    const serviceRole = await createServiceRole(awsIamRole, config, this.context.debug)

    config.dataSources = map((datasource) => {
      if (isNil(datasource.serviceRoleArn)) {
        datasource.serviceRoleArn = serviceRole.arn
      }
      return datasource
    }, config.dataSources)

    config.dataSources = await createOrUpdateDataSources(appSync, config, this.context.debug)
    config.schemaChecksum = await createSchema(appSync, config, this.state, this.context.debug)
    config.mappingTemplates = await createOrUpdateResolvers(appSync, config, this.context.debug)
    config.functions = await createOrUpdateFunctions(appSync, config, this.context.debug)
    config.apiKeys = await createOrUpdateApiKeys(appSync, config, this.state, this.context.debug)

    await removeObsoleteDataSources(appSync, config, this.state, this.context.debug)
    await removeObsoleteResolvers(appSync, config, this.state, this.context.debug)
    await removeObsoleteFunctions(appSync, config, this.state, this.context.debug)
    await removeObsoleteApiKeys(appSync, config, this.state, this.context.debug)

    this.state = pick(['apiId', 'arn', 'schemaChecksum', 'apiKeys', 'uris'], config)
    this.state.dataSources = map(pick(['name', 'type']), config.dataSources)
    this.state.mappingTemplates = map(pick(['type', 'field']), config.mappingTemplates)
    this.state.functions = map(pick(['name', 'dataSource', 'functionId']), config.functions) // deploy functions with same names is not possible
    await this.save()

    let output = {
      graphqlApi: pick(['apiId', 'arn', 'uris'], config)
    }
    if (not(isNil(config.apiKeys))) {
      output = merge(output, {
        apiKeys: map(({ id }) => id, config.apiKeys)
      })
    }
    return output
  }

  // eslint-disable-next-line no-unused-vars
  async remove(inputs = {}) {
    const config = mergeDeepRight(merge(defaults, { apiId: this.state.apiId }), inputs)
    const { appSync } = getClients(this.context.credentials.aws, config.region)
    await deleteGraphqlApi(appSync, { apiId: this.state.apiId })
    const awsIamRole = await this.load('@serverless/aws-iam-role')
    await awsIamRole.remove()
    this.state = {}
    await this.save()
  }
}

module.exports = AwsAppSync
