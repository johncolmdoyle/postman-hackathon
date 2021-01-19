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
import { DynamoEventSource, SqsDlq } from '@aws-cdk/aws-lambda-event-sources';
import { DockerImageAsset } from '@aws-cdk/aws-ecr-assets';
import { DynamoDB } from '@aws-sdk/client-dynamodb';

interface CdkPostmanStackProps extends cdk.StackProps {
  readonly certificate: acm.ICertificate;
  readonly regionalCert: acm.ICertificate;
  readonly initGlobalTableName: string;
  readonly finishGlobalTableName: string;
  readonly domainName: string;
  readonly subDomainName: string;
  readonly lambdaContainerRegions: string[];
  readonly env: any;
}

export class CdkPostmanStack extends cdk.Stack {

  constructor(scope: cdk.Construct, id: string, props: CdkPostmanStackProps) {
    super(scope, id, props);

    const client = new DynamoDB({ region: props.env.region });

    let initGlobalTableInfoRequest = async () => await client.describeTable({ TableName: props.initGlobalTableName});
    let finishGlobalTableInfoRequest = async () => await client.describeTable({ TableName: props.finishGlobalTableName});

     // IMPORT EXISTING TABLES
    initGlobalTableInfoRequest().then( initGlobalTableInfoRequestResult => {
      finishGlobalTableInfoRequest().then( finishGlobalTableInfoRequestResult => {

        // GLOBAL DYNAMODB
        const initGlobalTable = dynamodb.Table.fromTableAttributes(this, "importInitGlobalTable", {
          tableArn: initGlobalTableInfoRequestResult?.Table?.TableArn,
          tableStreamArn: initGlobalTableInfoRequestResult?.Table?.LatestStreamArn
        });

        const finishGlobalTable = dynamodb.Table.fromTableAttributes(this, "importFinishGlobalTable", {
          tableArn: finishGlobalTableInfoRequestResult?.Table?.TableArn,
          tableStreamArn: finishGlobalTableInfoRequestResult?.Table?.LatestStreamArn
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

        const regionGeoIPTable = new dynamodb.Table(this, "regionGeoIPTable", {
          billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
          partitionKey: { name: "ip", type: dynamodb.AttributeType.STRING },
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
              GEOIP_TABLE_NAME: regionGeoIPTable.tableName,
              GEOIP_PRIMARY_KEY: 'ip' 
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
          regionTable.grantWriteData(tracerouteLambda);
          regionTable.grantWriteData(digLambda);
          regionGeoIPTable.grantReadWriteData(tracerouteLambda);

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
        tests.addMethod('POST', initiatorIntegration);
        addCorsOptions(tests);

        const testId = tests.addResource('{id}');
        const retrieveIntegration = new apigateway.LambdaIntegration(retrieveLambda);
        testId.addMethod('GET', retrieveIntegration);
        addCorsOptions(testId);

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
