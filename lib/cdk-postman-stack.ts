import * as cdk from '@aws-cdk/core';
import * as lambda from '@aws-cdk/aws-lambda';
import * as apigateway from '@aws-cdk/aws-apigateway'; 
import * as dynamodb from '@aws-cdk/aws-dynamodb';
import * as sqs from '@aws-cdk/aws-sqs';
import * as ecr from '@aws-cdk/aws-ecr';
import * as acm from '@aws-cdk/aws-certificatemanager';
import * as route53 from '@aws-cdk/aws-route53';
import * as cloudfront from '@aws-cdk/aws-cloudfront';
import * as targets from '@aws-cdk/aws-route53-targets';
import * as iam from '@aws-cdk/aws-iam';
import { DynamoEventSource, SqsDlq } from '@aws-cdk/aws-lambda-event-sources';
import { DockerImageAsset } from '@aws-cdk/aws-ecr-assets';
import { DynamoDB } from '@aws-sdk/client-dynamodb';

interface CdkPostmanStackProps extends cdk.StackProps {
  readonly certificate: acm.ICertificate;
  readonly regionalCert: acm.ICertificate;
  readonly initGlobalTableName: string;
  readonly finishGlobalTableName: string;
  readonly apiKeyGlobalTableName: string;
  readonly geoIpGlobalTableName: string;
  readonly domainName: string;
  readonly subDomainName: string;
  readonly lambdaContainerRegions: string[];
  readonly env: any;
  readonly ipapiKey: string;
}

export class CdkPostmanStack extends cdk.Stack {

  constructor(scope: cdk.Construct, id: string, props: CdkPostmanStackProps) {
    super(scope, id, props);

    const client = new DynamoDB({ region: props.env.region });

    let initGlobalTableInfoRequest = async () => await client.describeTable({ TableName: props.initGlobalTableName});
    let finishGlobalTableInfoRequest = async () => await client.describeTable({ TableName: props.finishGlobalTableName});
    let apiKeyGlobalTableInfoRequest = async () => await client.describeTable({ TableName: props.apiKeyGlobalTableName});
    let geoIpGlobalTableInfoRequest = async () => await client.describeTable({ TableName: props.geoIpGlobalTableName});

     // IMPORT EXISTING TABLES
    initGlobalTableInfoRequest().then( initGlobalTableInfoRequestResult => {
      finishGlobalTableInfoRequest().then( finishGlobalTableInfoRequestResult => {
        apiKeyGlobalTableInfoRequest().then( apiKeyGlobalTableInfoRequestResult => {
          geoIpGlobalTableInfoRequest().then( geoIpGlobalTableInfoRequestResult => {

            // GLOBAL DYNAMODB
            const initGlobalTable = dynamodb.Table.fromTableAttributes(this, "importInitGlobalTable", {
              tableArn: initGlobalTableInfoRequestResult?.Table?.TableArn,
              tableStreamArn: initGlobalTableInfoRequestResult?.Table?.LatestStreamArn
            });

            const finishGlobalTable = dynamodb.Table.fromTableAttributes(this, "importFinishGlobalTable", {
              tableArn: finishGlobalTableInfoRequestResult?.Table?.TableArn,
              tableStreamArn: finishGlobalTableInfoRequestResult?.Table?.LatestStreamArn
            });

            const apiKeyGlobalTable = dynamodb.Table.fromTableAttributes(this, "importApiGlobalTable", {
              tableArn: apiKeyGlobalTableInfoRequestResult?.Table?.TableArn,
              tableStreamArn: apiKeyGlobalTableInfoRequestResult?.Table?.LatestStreamArn
            });

            const geoIpGlobalTable = dynamodb.Table.fromTableAttributes(this, "importGeoIpGlobalTable", {
              tableArn: geoIpGlobalTableInfoRequestResult?.Table?.TableArn,
            });

            // REGIONAL DYNAMODB
            const regionTable = new dynamodb.Table(this, "regionTable", {
              billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, 
              partitionKey: { name: "initId", type: dynamodb.AttributeType.STRING },
              sortKey: { name: "functionCall", type: dynamodb.AttributeType.STRING },
              timeToLiveAttribute: 'ttl',
              removalPolicy: cdk.RemovalPolicy.DESTROY,
              stream: dynamodb.StreamViewType.NEW_IMAGE
            });

            const regionApiKeyTable = new dynamodb.Table(this, "regionApiKeyTable", {
              billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
              partitionKey: { name: "cognitoIdentityId", type: dynamodb.AttributeType.STRING },
              removalPolicy: cdk.RemovalPolicy.DESTROY,
            });

            // NODE LAMBDA
            const initiatorLambda = new lambda.Function(this, 'initiatorFunction', {
              code: new lambda.AssetCode('src/non-docker'),
              handler: 'initiator.handler',
              runtime: lambda.Runtime.NODEJS_10_X,
              environment: {
                TABLE_NAME: initGlobalTable.tableName,
                PRIMARY_KEY: 'initId'
              }
            });

            const nslookupLambda = new lambda.Function(this, 'nslookupFunction', {
              code: new lambda.AssetCode('src/non-docker'),
              handler: 'nslookup.handler',
              runtime: lambda.Runtime.NODEJS_10_X,
              environment: {
                TABLE_NAME: regionTable.tableName,
                PRIMARY_KEY: 'initId',
                SORT_KEY: 'functionCall'
              }
            });

            const whoisLambda = new lambda.Function(this, 'whoisFunction', {
              code: new lambda.AssetCode('src/non-docker'),
              handler: 'whois.handler',
              runtime: lambda.Runtime.NODEJS_10_X,
              environment: {
                TABLE_NAME: regionTable.tableName,
                PRIMARY_KEY: 'initId',
                SORT_KEY: 'functionCall'
              }
            });

            const responseLambda = new lambda.Function(this, 'responseFunction', {
              code: new lambda.AssetCode('src/non-docker'),
              handler: 'response.handler',
              runtime: lambda.Runtime.NODEJS_10_X,
              timeout: cdk.Duration.seconds(120),
              environment: {
                TABLE_NAME: regionTable.tableName,
                PRIMARY_KEY: 'initId',
                SORT_KEY: 'functionCall'
              }
            });

            const finishedLambda = new lambda.Function(this, 'finishedFunction', {
              code: new lambda.AssetCode('src/non-docker'),
              handler: 'finished.handler',
              runtime: lambda.Runtime.NODEJS_10_X,
              environment: {
                TABLE_NAME: finishGlobalTable.tableName,
                PRIMARY_KEY: 'initId',
                SORT_KEY: 'region'
              }
            });

            const retrieveLambda = new lambda.Function(this, 'retrieveFunction', {
              code: new lambda.AssetCode('src/non-docker'),
              handler: 'retrieve.handler',
              runtime: lambda.Runtime.NODEJS_10_X,
              environment: {
                TABLE_NAME: finishGlobalTable.tableName,
                PRIMARY_KEY: 'initId'
              }
            });

            const retrievePrivateLambda = new lambda.Function(this, 'retrievePrivateFunction', {
              code: new lambda.AssetCode('src/non-docker'),
              handler: 'retrievePrivate.handler',
              runtime: lambda.Runtime.NODEJS_10_X,
              environment: {
                TABLE_NAME: initGlobalTable.tableName,
                PRIMARY_KEY: 'apiKey'
              }
            });

            const healthLambda = new lambda.Function(this, 'healthFunction', {
              code: new lambda.AssetCode('src/non-docker'),
              handler: 'health.handler',
              runtime: lambda.Runtime.NODEJS_10_X
            });

            // NODE LAMBDA PERMISSIONS
            initGlobalTable.grantWriteData(initiatorLambda);
            initGlobalTable.grantStreamRead(nslookupLambda);
            initGlobalTable.grantStreamRead(whoisLambda);
            initGlobalTable.grantStreamRead(retrieveLambda);
            initGlobalTable.grantStreamRead(responseLambda);
            regionTable.grantWriteData(nslookupLambda);
            regionTable.grantWriteData(whoisLambda);
            regionTable.grantWriteData(responseLambda);
            finishGlobalTable.grantWriteData(finishedLambda);
            finishGlobalTable.grantReadData(retrieveLambda);

            // DEADLETTER QUEUE
            const nslookupDeadLetterQueue = new sqs.Queue(this, 'nslookUpDeadLetterQueue');
            const whoisDeadLetterQueue = new sqs.Queue(this, 'whoisDeadLetterQueue');
            const responseDeadLetterQueue = new sqs.Queue(this, 'responseDeadLetterQueue');
            const finsihedDeadLetterQueue = new sqs.Queue(this, 'finishedDeadLetterQueue');

            // DYNAMODB TRIGGER
            nslookupLambda.addEventSource(new DynamoEventSource(initGlobalTable, {
              startingPosition: lambda.StartingPosition.TRIM_HORIZON,
              batchSize: 5,
              bisectBatchOnError: true,
              onFailure: new SqsDlq(nslookupDeadLetterQueue),
              retryAttempts: 10
            }));

            whoisLambda.addEventSource(new DynamoEventSource(initGlobalTable, {
              startingPosition: lambda.StartingPosition.TRIM_HORIZON,
              batchSize: 5,
              bisectBatchOnError: true,
              onFailure: new SqsDlq(whoisDeadLetterQueue),
              retryAttempts: 10
            }));

            responseLambda.addEventSource(new DynamoEventSource(initGlobalTable, {
              startingPosition: lambda.StartingPosition.TRIM_HORIZON,
              batchSize: 5,
              bisectBatchOnError: true,
              onFailure: new SqsDlq(responseDeadLetterQueue),
              retryAttempts: 10
            }));

            finishedLambda.addEventSource(new DynamoEventSource(regionTable, {
              startingPosition: lambda.StartingPosition.TRIM_HORIZON,
              batchSize: 5,
              bisectBatchOnError: true,
              onFailure: new SqsDlq(finsihedDeadLetterQueue),
              retryAttempts: 10
            }));

            // DOCKER LAMBDA
            // only deploy to regions that support containers
            if(props.lambdaContainerRegions.indexOf(props.env.region) >= 0) {
              // LAMBDA
              const tracerouteLambda = new lambda.DockerImageFunction(this, 'tracerouteFunction', {
                code: lambda.DockerImageCode.fromImageAsset('src/docker/traceroute'),
                timeout: cdk.Duration.seconds(120),
                environment: {
                  TABLE_NAME: regionTable.tableName,
                  PRIMARY_KEY: 'initId',
                  SORT_KEY: 'functionCall',
                  GEOIP_TABLE_NAME: geoIpGlobalTable.tableName,
                  GEOIP_PRIMARY_KEY: 'ip',
                  IPAPI_KEY: props.ipapiKey 
                }
              });

              const digLambda = new lambda.DockerImageFunction(this, 'digFunction', {
                code: lambda.DockerImageCode.fromImageAsset('src/docker/dig'),
                timeout: cdk.Duration.seconds(120),
                environment: {
                  TABLE_NAME: regionTable.tableName,
                  PRIMARY_KEY: 'initId',
                  SORT_KEY: 'functionCall'
                }
              });

              // PERMISSION
              initGlobalTable.grantStreamRead(tracerouteLambda);
              initGlobalTable.grantStreamRead(digLambda);
              regionTable.grantWriteData(tracerouteLambda);
              regionTable.grantWriteData(digLambda);
              geoIpGlobalTable.grantReadWriteData(tracerouteLambda);

              // DEAD LETTER
              const tracerouteDeadLetterQueue = new sqs.Queue(this, 'tracerouteDeadLetterQueue');
              const digDeadLetterQueue = new sqs.Queue(this, 'digDeadLetterQueue');

              // DYNAMODB TRIGGER
              tracerouteLambda.addEventSource(new DynamoEventSource(initGlobalTable, {
                startingPosition: lambda.StartingPosition.TRIM_HORIZON,
                batchSize: 5,
                bisectBatchOnError: true,
                onFailure: new SqsDlq(tracerouteDeadLetterQueue),
                retryAttempts: 10
              }));

              digLambda.addEventSource(new DynamoEventSource(initGlobalTable, {
                startingPosition: lambda.StartingPosition.TRIM_HORIZON,
                batchSize: 5,
                bisectBatchOnError: true,
                onFailure: new SqsDlq(digDeadLetterQueue),
                retryAttempts: 10
              }));
            }

            // API
            const api = new apigateway.RestApi(this, 'networkApi', {
              restApiName: 'API Network Service',
            });
 
            const regionalApiCustomDomain = new apigateway.DomainName(this, 'regionalApiCustomDomain', {
              domainName: props.env.region.concat("." + props.domainName),
              certificate: props.regionalCert
            });

            regionalApiCustomDomain.addBasePathMapping(api);

            const restApiCustomDomain = new apigateway.DomainName(this, 'restApiCustomDomain', {
              domainName: props.subDomainName.concat(props.domainName),
              certificate: props.certificate
            });

            restApiCustomDomain.addBasePathMapping(api);

            // API Calls
            const tests = api.root.addResource('tests');

            const initiatorIntegration = new apigateway.LambdaIntegration(initiatorLambda);
            const createTestMethod = tests.addMethod('POST', initiatorIntegration, { 
                                       apiKeyRequired: true 
                                     });
            addCorsOptions(tests);

            const testId = tests.addResource('{id}');
            const retrieveIntegration = new apigateway.LambdaIntegration(retrieveLambda);
            testId.addMethod('GET', retrieveIntegration);
            addCorsOptions(testId);

            const privatePath = api.root.addResource('private');
            const retrievePrivateIntegration = new apigateway.LambdaIntegration(retrievePrivateLambda);
            const createPrivateMethod = privatePath.addMethod('GET', retrievePrivateIntegration, {
                                       apiKeyRequired: true
                                     });
            addCorsOptions(privatePath);

            // Usage Plans
            const freeUsagePlan = api.addUsagePlan('freeUsagePlan', {
              name: 'Api-Network-Free',
              quota: {
                limit: 10,
                period: apigateway.Period.DAY
              },
              throttle: {
                rateLimit: 10,
                burstLimit: 2
              }
            });

            freeUsagePlan.addApiStage({
              stage: api.deploymentStage,
              throttle: [{
                method: createTestMethod,
                throttle: {
                  rateLimit: 1,
                  burstLimit: 2
                }
              }]
            });

            // API Key Global Import
            const apiKeyLambda = new lambda.Function(this, 'apiKeyFunction', {
              code: new lambda.AssetCode('src/non-docker'),
              handler: 'apikey.handler',
              runtime: lambda.Runtime.NODEJS_10_X,
              environment: {
                USAGE_PLAN_ID: freeUsagePlan.usagePlanId,
                TABLE_NAME: regionApiKeyTable.tableName,
                PRIMARY_KEY: "cognitoIdentityId"
              }
            });

            // Permissions
            apiKeyGlobalTable.grantStreamRead(apiKeyLambda);
            regionApiKeyTable.grantReadWriteData(apiKeyLambda);

            apiKeyLambda.addToRolePolicy(
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                resources: ['arn:aws:apigateway:' + props.env.region + '::/tags/arn%3Aaws%3Aapigateway%3A' + props.env.region + '%3A%3A%2Fapikeys%2F*'],
                actions: ['apigateway:PUT']
              }) 
            );

            apiKeyLambda.addToRolePolicy(
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                resources: ['arn:aws:apigateway:' + props.env.region + '::/apikeys/*'],
                actions: ['apigateway:DELETE']
              })
            );

            apiKeyLambda.addToRolePolicy(
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                resources: ['arn:aws:apigateway:' + props.env.region + '::/apikeys'],
                actions: ['apigateway:POST']
              })
            );


            apiKeyLambda.addToRolePolicy(
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                resources: ['arn:aws:apigateway:' + props.env.region + '::/usageplans/' + freeUsagePlan.usagePlanId + '/keys'],
                actions: ['apigateway:POST']
              })
            );

            // DEAD LETTER
            const apiKeyDeadLetterQueue = new sqs.Queue(this, 'apiKeyDeadLetterQueue');

            // DYNAMODB TRIGGER
            apiKeyLambda.addEventSource(new DynamoEventSource(apiKeyGlobalTable, {
              startingPosition: lambda.StartingPosition.TRIM_HORIZON,
              batchSize: 5,
              bisectBatchOnError: true,
              onFailure: new SqsDlq(apiKeyDeadLetterQueue),
              retryAttempts: 10
            }));

            // API Health
            const health = api.root.addResource('health');
            const healthIntegration = new apigateway.LambdaIntegration(healthLambda);
            health.addMethod('GET', healthIntegration);
            addCorsOptions(health);

            // ROUTE 53
            const zone = route53.HostedZone.fromLookup(this, "zone", { domainName: props.domainName });

            const regionalApiRecord = new route53.ARecord(this, 'regionalApiCustomDomainAliasRecord', {
              zone: zone,
              recordName: props.env.region,
              target: route53.RecordTarget.fromAlias(new targets.ApiGatewayDomain(regionalApiCustomDomain))
            });

            const regionalRecordHealthCheck = new route53.CfnHealthCheck(this, 'regionApiDomainHealthCheck', {
              healthCheckConfig: {
                type: "HTTPS",
                port: 443,
                enableSni: true,
                fullyQualifiedDomainName: props.env.region.concat("." + props.domainName),
                resourcePath: "/health"
              },
              healthCheckTags: [
                {
                  key: "Name",
                  value: "API Network Health Check ".concat(props.env.region)
                }
              ]
            });

            const globalApiRecord = new route53.CfnRecordSet(this, 'globalApiDomain', {
              name: props.subDomainName.concat(props.domainName + "."),
              type: "A",
              aliasTarget: {
                dnsName: restApiCustomDomain.domainNameAliasDomainName,
                hostedZoneId: restApiCustomDomain.domainNameAliasHostedZoneId 
              }, 
              healthCheckId: regionalRecordHealthCheck.getAtt("HealthCheckId").toString(),
              hostedZoneId: zone.hostedZoneId,
              region: props.env.region,
              setIdentifier: "api-" + props.env.region
            });
          }).catch(error => console.log("Region: " + props.env.region + "\n TableName: " + props.geoIpGlobalTableName + "\n Error: " + error));
        }).catch(error => console.log("Region: " + props.env.region + "\n TableName: " + props.apiKeyGlobalTableName + "\n Error: " + error));
      }).catch(error => console.log("Region: " + props.env.region + "\n TableName: " + props.finishGlobalTableName + "\n Error: " + error));
    }).catch(error => console.log("Region: " + props.env.region + "\n TableName: " + props.initGlobalTableName + "\n Error: " + error));
  }
}

export function addCorsOptions(apiResource: apigateway.IResource) {
  apiResource.addMethod('OPTIONS', new apigateway.MockIntegration({
    integrationResponses: [{
      statusCode: '200',
      responseParameters: {
        'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent'",
        'method.response.header.Access-Control-Allow-Origin': "'*'",
        'method.response.header.Access-Control-Allow-Credentials': "'false'",
        'method.response.header.Access-Control-Allow-Methods': "'OPTIONS,GET,PUT,POST,DELETE'",
      },
    }],
    passthroughBehavior: apigateway.PassthroughBehavior.NEVER,
    requestTemplates: {
      "application/json": "{\"statusCode\": 200}"
    },
  }), {
    methodResponses: [{
      statusCode: '200',
      responseParameters: {
        'method.response.header.Access-Control-Allow-Headers': true,
        'method.response.header.Access-Control-Allow-Methods': true,
        'method.response.header.Access-Control-Allow-Credentials': true,
        'method.response.header.Access-Control-Allow-Origin': true,
      },  
    }]
  })
}
