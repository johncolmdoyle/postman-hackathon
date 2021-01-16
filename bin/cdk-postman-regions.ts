#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { CdkPostmanStack } from '../lib/cdk-postman-stack';
import { CdkPostmanCertStack } from '../lib/cdk-postman-certificate-stack';
import { hackathonConfig } from '../hackathon-config';

const app = new cdk.App();

hackathonConfig.replicationRegions.forEach(function (item, index) {
  const regioncertstack = new CdkPostmanCertStack(app, 'Postman-Cert-'.concat(item), {
    env: {account: process.env.CDK_DEFAULT_ACCOUNT, region: item},
    domainName: hackathonConfig.domainName,
    subDomainName: hackathonConfig.subDomainName});

  const regionstack = new CdkPostmanStack(app, 'Postman-App-'.concat(item), {
    env: {account: process.env.CDK_DEFAULT_ACCOUNT, region: item},
    domainName: hackathonConfig.domainName,
    subDomainName: hackathonConfig.subDomainName,
    certificate: regioncertstack.cert,
    initGlobalTableName: hackathonConfig.globalInitTableName,
    finishGlobalTableName: hackathonConfig.globalFinishTableName,
    lambdaContainerRegions: hackathonConfig.lambdaContainerRegions},);
});

cdk.Tags.of(app).add("app", "postman-hackathon");

