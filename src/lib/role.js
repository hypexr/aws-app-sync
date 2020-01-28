const {
  concat,
  equals,
  flatten,
  isNil,
  isEmpty,
  find,
  toPairs,
  map,
  not,
  pipe,
  reduce
} = require('ramda')
const { sleep, getAccountId } = require('./utils')

/**
 * Create service role for all datasources
 * @param {Object} awsIamRole
 * @param {Object} config
 * @param {Function} debug
 * @return {Object} - deployed service role
 */
const createServiceRole = async (iam, inputs) => {
  const accountId = await getAccountId()
  const statements = pipe(
    reduce((acc, dataSource) => {
      if (isNil(dataSource.serviceRoleArn)) {
        if (not(acc[dataSource.type])) {
          acc[dataSource.type] = []
        }
        const existingItem = find(
          (dataSourceConfig) => equals(dataSourceConfig, dataSource.config),
          acc[dataSource.type]
        )
        if (isNil(existingItem)) {
          acc[dataSource.type] = concat(acc[dataSource.type], [dataSource.config])
        }
      }
      return acc
    }, {}),
    toPairs,
    map(([type, dataSourceConfigs]) => {
      switch (type) {
        case 'AWS_LAMBDA':
          return [
            {
              Action: ['lambda:invokeFunction'],
              Effect: 'Allow',
              Resource: flatten(
                map(
                  (dataSourceConfig) => [
                    dataSourceConfig.lambdaFunctionArn,
                    `${dataSourceConfig.lambdaFunctionArn}:*`
                  ],
                  dataSourceConfigs
                )
              )
            }
          ]
        case 'AMAZON_DYNAMODB':
          return [
            {
              Action: [
                'dynamodb:DeleteItem',
                'dynamodb:GetItem',
                'dynamodb:PutItem',
                'dynamodb:Query',
                'dynamodb:Scan',
                'dynamodb:UpdateItem',
                'dynamodb:BatchGetItem',
                'dynamodb:BatchWriteItem'
              ],
              Effect: 'Allow',
              Resource: flatten(
                map(
                  (dataSourceConfig) => [
                    `arn:aws:dynamodb:${dataSourceConfig.region ||
                      inputs.region}:${dataSourceConfig.accountId || accountId}:table/${
                      dataSourceConfig.tableName
                    }`,
                    `arn:aws:dynamodb:${dataSourceConfig.region ||
                      inputs.region}:${dataSourceConfig.accountId || accountId}:table/${
                      dataSourceConfig.tableName
                    }/*`
                  ],
                  dataSourceConfigs
                )
              )
            }
          ]
        case 'AMAZON_ELASTICSEARCH':
          return [
            {
              Action: [
                'es:ESHttpDelete',
                'es:ESHttpGet',
                'es:ESHttpHead',
                'es:ESHttpPost',
                'es:ESHttpPut'
              ],
              Effect: 'Allow',
              Resource: map((dataSourceConfig) => {
                const result = /^https:\/\/([a-z0-9\-]+\.\w{2}\-[a-z]+\-\d\.es\.amazonaws\.com)$/.exec(
                  dataSourceConfig.endpoint
                )
                return `arn:aws:es:${dataSourceConfig.region ||
                  inputs.region}:${dataSourceConfig.accountId || accountId}:domain/${result[1]}`
              }, dataSourceConfigs)
            }
          ]
        case 'RELATIONAL_DATABASE':
          return [
            {
              Effect: 'Allow',
              Action: [
                'rds-data:DeleteItems',
                'rds-data:ExecuteSql',
                'rds-data:ExecuteStatement',
                'rds-data:GetItems',
                'rds-data:InsertItems',
                'rds-data:UpdateItems'
              ],
              Resource: flatten(
                map(
                  (dataSourceConfig) => [
                    `arn:aws:rds:${dataSourceConfig.region ||
                      config.region}:${dataSourceConfig.accountId || accountId}:cluster:${
                      dataSourceConfig.dbClusterIdentifier
                    }`,
                    `arn:aws:rds:${dataSourceConfig.region ||
                      config.region}:${dataSourceConfig.accountId || accountId}:cluster:${
                      dataSourceConfig.dbClusterIdentifier
                    }:*`
                  ],
                  dataSourceConfigs
                )
              )
            },
            {
              Effect: 'Allow',
              Action: ['secretsmanager:GetSecretValue'],
              Resource: flatten(
                map(
                  (dataSourceConfig) => [
                    dataSourceConfig.awsSecretStoreArn,
                    `${dataSourceConfig.awsSecretStoreArn}:*`
                  ],
                  dataSourceConfigs
                )
              )
            }
          ]
        default:
          break
      }
    }),
    flatten
  )(inputs.dataSources)
  if (statements) {
    console.log('Create/update service role')
    return createRole(iam, statements, inputs.name)
  }
  // todo remove role and policy
  return {}
}

const createRole = async (iam, statements, apiName) => {
  const roleName = `${apiName}-role`
  const policyName = `${apiName}-policy`
  const assumeRolePolicyDocument = {
    Version: '2012-10-17',
    Statement: {
      Effect: 'Allow',
      Principal: {
        Service: ['appsync.amazonaws.com']
      },
      Action: 'sts:AssumeRole'
    }
  }
  const res = await iam
    .createRole({
      RoleName: roleName,
      Path: '/',
      AssumeRolePolicyDocument: JSON.stringify(assumeRolePolicyDocument)
    })
    .promise()

  const policyDocument = JSON.stringify({ Version: '2012-10-17', Statement: statements })

  const createPolicyParams = {
    PolicyName: policyName,
    PolicyDocument: policyDocument
  }

  const policyRes = await iam.createPolicy(createPolicyParams).promise()
  const policyArn = policyRes.Policy.Arn

  await iam
    .attachRolePolicy({
      RoleName: roleName,
      PolicyArn: policyArn
    })
    .promise()

  await sleep(10000)

  return { roleArn: res.Role.Arn, policyArn: policyArn }
}

/**
 * Remove role
 * @param {*} iam 
 * @param {*} autoRoleArn
 * @param {*} autoPolicyArn 
 */
const removeRole = async (iam, autoRoleArn, autoPolicyArn) => {
  try {
    await iam
      .detachRolePolicy({
        RoleName: autoRoleArn.split('/')[1], // extract role name from arn
        PolicyArn: autoPolicyArn
      })
      .promise()
    await iam
      .deletePolicy({
        PolicyArn: autoPolicyArn
      })
      .promise()
    await iam
      .deleteRole({
        RoleName: autoRoleArn.split('/')[1]
      })
      .promise()
  } catch (error) {
    if (error.code !== 'NoSuchEntity') {
      throw error
    }
  }
}

/**
 * Exports
 */
module.exports = {
  createServiceRole,
  createRole,
  removeRole
}
