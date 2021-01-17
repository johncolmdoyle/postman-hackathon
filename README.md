# API-NETWORK

## Developer Setup

Need to have the following tools installed:

* AWS CDK
* Docker
* Node
* Typescript

### Config

The configuration is stored in `hackathon-config.ts`. The following values are most important:

Configuration | Description
------------ | -------------
replicationRegions|This is the list of regions that will have the application deployed to. The first region in the list will be the primary region for the DynamoDB Global Table. These are the only regions that support DynamoDB Global Tables.
lambdaContainerRegions|This is the list of regions that currently support container based Lambdas. Only in these regions will the Docker images be deployed to.
globalInitTableName|This is the DynamoDB Global table that will hold the user's initial request data.
globalFinishTableName|This is the DynamoDB Global table that will contain all the results from the replicated regions.
domainName|The domain name that will be used.
subDomainName|he sub domain used by the API Gateway and the Certificate Manager.

The remaining configurations on replication regions are not used and simply there to help deploy to different areas.

### First Deploy

One issue I did face was trying to depoy and replicate to ALL regions initially. I ended up first deploying to the US regions first, then adding the EU regions, the Asia regions, and then the remainder. 

Before deploying the code to a region, the AWS CDK must first be bootstraped for that region. To simply this process, this command will run through the regions in `hackathon-config.ts` and bootstrap the CDK in the `replicationRegions` list.

```
npm run cdk-bootstrap-regions
```

### Deploy

One aspect of this multi region deploy that did not work well was the DynamoDB Global table. This is because the Global table is deployed to a primary region (First element in `replicationRegions`) and then replicated from that region to the others. The AWS CDK enforces the Cloudformation rule that you can not set cross-region dependencies on stacks.

As a result there are two CDK applications, the first to deploy and replicate the DynamoDB Global table, and the second that will deploy the application in the region.

* `bin/cdk-postman-global.ts`   Deploys the DynamoDB Global table to the primary region
* `bin/cdk-postman-regions.ts`  Deploys the application code in all the regions.

To run the deployment, this has been simplified to an NPM script:

```
npm run deploy-all
```
