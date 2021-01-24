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
    regionalCert: regioncertstack.regionalCert,
    initGlobalTableName: hackathonConfig.globalInitTableName,
    finishGlobalTableName: hackathonConfig.globalFinishTableName,
    apiKeyGlobalTableName: hackathonConfig.globalApiKeyTableName,
    geoIpGlobalTableName: hackathonConfig.globalGeoIpTableName,
    lambdaContainerRegions: hackathonConfig.lambdaContainerRegions,
    ipapiKey: hackathonConfig.ipapiKey 
  });

  regionstack.addDependency(regioncertstack);
});

cdk.Tags.of(app).add("app", "postman-hackathon");

