import * as cdk from '@aws-cdk/core';
import * as dynamodb from '@aws-cdk/aws-dynamodb';

interface CdkPostmanGlobalStackProps extends cdk.StackProps {
  initialTableName: string;
  finishTableName: string;
  replicationRegions: string[];
}

export class CdkPostmanGlobalStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: CdkPostmanGlobalStackProps) {
    super(scope, id, props);

    // Init Table
    const initTable = new dynamodb.Table(this, 'postman-hackathon-init', {
      partitionKey: {
        name: 'initId',
        type: dynamodb.AttributeType.STRING
      },
      tableName: props.initialTableName,
      billingMode: dynamodb.BillingMode.PROVISIONED,
      replicationRegions: props.replicationRegions,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT recommended for production code
    });

    // Finish Table
    const finishTable = new dynamodb.Table(this, 'postman-hackathon-finish', {
      partitionKey: { name: 'initId',type: dynamodb.AttributeType.STRING},
      sortKey: { name:"region", type: dynamodb.AttributeType.STRING },
      tableName: props.finishTableName,
      billingMode: dynamodb.BillingMode.PROVISIONED,
      replicationRegions: props.replicationRegions,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT recommended for production code
    });

    initTable.autoScaleWriteCapacity({
      minCapacity: 1,
      maxCapacity: 10,
    }).scaleOnUtilization({ targetUtilizationPercent: 75 });

    finishTable.autoScaleWriteCapacity({
      minCapacity: 1,
      maxCapacity: 10,
    }).scaleOnUtilization({ targetUtilizationPercent: 75 });
  }
}
