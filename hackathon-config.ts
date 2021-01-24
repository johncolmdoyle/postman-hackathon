export let hackathonConfig = {
  "replicationRegions": ["us-west-2", "us-east-1", "us-east-2", "us-west-1", "ca-central-1", "eu-north-1", "eu-west-3", "eu-west-2", "eu-west-1", "eu-central-1", "ap-south-1", "ap-northeast-2", "ap-northeast-1", "sa-east-1", "ap-southeast-1", "ap-southeast-2"],
  "replicationRegionsUs": ["us-west-2", "us-east-1", "us-east-2", "us-west-1"],
  "replicationRegionsCa": ["ca-central-1"],
  "replicationRegionsEu": ["eu-north-1", "eu-west-3", "eu-west-2", "eu-west-1", "eu-central-1"],
  "replicationRegionsAsia": ["ap-south-1", "ap-northeast-2", "ap-northeast-1", "sa-east-1", "ap-southeast-1", "ap-southeast-2"],
  "lambdaContainerRegions": ["us-east-1", "eu-west-1", "ap-northeast-1", "us-west-2", "ap-southeast-1", "eu-central-1", "us-east-2", "sa-east-1"],
  "globalInitTableName": "postman-hackathon-init",
  "globalFinishTableName": "postman-hackathon-finish",
  "globalApiKeyTableName": "postman-hackathon-apikey",
  "globalGeoIpTableName": "postman-hackathon-geoip",
  "domainName": "api-network.info",
  "subDomainName": "rest.",
  "ipapiKey": ""
}
