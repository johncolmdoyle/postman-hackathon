import * as cdk from '@aws-cdk/core';
import * as lambda from '@aws-cdk/aws-lambda';
import * as apigateway from '@aws-cdk/aws-apigateway'; 
import * as dynamodb from '@aws-cdk/aws-dynamodb';
import * as sqs from '@aws-cdk/aws-sqs';
import * as ecr from '@aws-cdk/aws-ecr';
import * as acm from '@aws-cdk/aws-certificatemanager';
import * as route53 from '@aws-cdk/aws-route53';
import { DynamoEventSource, SqsDlq } from '@aws-cdk/aws-lambda-event-sources';
import { DockerImageAsset } from '@aws-cdk/aws-ecr-assets';
import { DynamoDB } from '@aws-sdk/client-dynamodb';

interface CdkPostmanStackProps extends cdk.StackProps {
  readonly initGlobalTableName: string;
  readonly finishGlobalTableName: string;
  readonly domainName: string;
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

        // NODE LAMBDA PERMISSIONS
        initGlobalTable.grantWriteData(initiatorLambda);
        initGlobalTable.grantStreamRead(nslookupLambda);
        regionTable.grantWriteData(nslookupLambda);
        finishGlobalTable.grantWriteData(finishedLambda);

        // DEADLETTER QUEUE
        const nslookupDeadLetterQueue = new sqs.Queue(this, 'nslookUpDeadLetterQueue');
        const finsihedDeadLetterQueue = new sqs.Queue(this, 'finishedDeadLetterQueue');

        // DYNAMODB TRIGGER
        nslookupLambda.addEventSource(new DynamoEventSource(initGlobalTable, {
          startingPosition: lambda.StartingPosition.TRIM_HORIZON,
          batchSize: 5,
          bisectBatchOnError: true,
          onFailure: new SqsDlq(nslookupDeadLetterQueue),
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
              SORT_KEY: 'functionCall'
            }
          });

          // PERMISSION
          regionTable.grantWriteData(tracerouteLambda);

          // DEAD LETTER
          const tracerouteDeadLetterQueue = new sqs.Queue(this, 'tracerouteDeadLetterQueue');

          // DYNAMODB TRIGGER
          tracerouteLambda.addEventSource(new DynamoEventSource(initGlobalTable, {
            startingPosition: lambda.StartingPosition.TRIM_HORIZON,
            batchSize: 5,
            bisectBatchOnError: true,
            onFailure: new SqsDlq(tracerouteDeadLetterQueue),
            retryAttempts: 10
          }));
        }

        // API
        const api = new apigateway.RestApi(this, 'networkApi', {
          restApiName: 'Network Service',
          endpointTypes: [apigateway.EndpointType.REGIONAL]
        });

        const tests = api.root.addResource('tests');

        const initiatorIntegration = new apigateway.LambdaIntegration(initiatorLambda);
        tests.addMethod('POST', initiatorIntegration);
        addCorsOptions(tests);

        // ROUTE 53
        const hostedZone = new route53.HostedZone(this, 'domainHostedZone', {
          zoneName: props.domainName
        });

//        const cert = new acm.Certificate(this, "certApi", {
//          domainName: props.domainName,
//          validation: acm.CertificateValidation.fromDns(hostedZone)
//        });

//        const domain = new apigateway.DomainName(this, "domainApi", {
//          domainName: props.domainName,
//          certificate: cert,
//          endpointType: apigateway.EndpointType.REGIONAL
//        });

//        new apigateway.CfnBasePathMapping(this, "regionalApiMapping", {
//          domainName: props.domainName,
//          restApiId: api.restApiId,
//          stage: api.deploymentStage.stageName
//        });

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
