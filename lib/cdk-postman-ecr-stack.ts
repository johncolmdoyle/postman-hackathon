import * as cdk from '@aws-cdk/core';
import * as ecr from '@aws-cdk/aws-ecr';

export class CdkPostmanECRStack extends cdk.Stack {
  public readonly tracerouteECR: ecr.IRepository;

  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ECR
    const tracerouteRepository = new ecr.Repository(this, 'tracerouteRepository');


    // Outputs
    this.tracerouteECR = tracerouteRepository;
  }
}
