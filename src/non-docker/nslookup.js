const AWS = require('aws-sdk');
const dns = require('dns');

const db = new AWS.DynamoDB.DocumentClient();

const TABLE_NAME = process.env.TABLE_NAME || '';
const PRIMARY_KEY = process.env.PRIMARY_KEY || '';
const SORT_KEY = process.env.SORT_KEY || '';

const RESERVED_RESPONSE = `Error: You're using AWS reserved keywords as attributes`,
  DYNAMODB_EXECUTION_ERROR = `Error: Execution update, caused a Dynamodb error, please take a look at your CloudWatch Logs.`;

async function lookupPromise(domain){
    return new Promise((resolve, reject) => {
        const options = {
          all: true
        };
        
        dns.lookup(domain, options, (err, address, family) => {
            if(err) reject(err);
            resolve(address);
        });
   });
};

async function resolve4Promise(domain){
    return new Promise((resolve, reject) => {
        const options = {
          ttl: true
        };
        
        dns.resolve4(domain, options, (err, address, family) => {
            if(err) reject(err);
            resolve(address);
        });
   });
};

async function resolve6Promise(domain){
    return new Promise((resolve, reject) => {
        const options = {
          ttl: true
        };
        
        dns.resolve6(domain, options, (err, address, family) => {
            if(err) reject(err);
            resolve(address);
        });
   });
};

async function resolveAnyPromise(domain){
    return new Promise((resolve, reject) => {
        const options = {
          ttl: true
        };
        
        dns.resolveAny(domain, options, (err, address, family) => {
            if(err) reject(err);
            resolve(address);
        });
   });
};

exports.handler = async (event, context) => {
  let item = {};

  const TTL_DELTA = 60 * 60 * 24 * 2; // Keep records for 2 days

  for (const record of event.Records) {
    item[PRIMARY_KEY] = record.dynamodb.NewImage.initId.S;
    item[SORT_KEY] = 'nslookup';
    item['regionFunction'] = process.env.AWS_REGION;
    item['createdAt'] = (Math.floor(+new Date() / 1000)).toString();
    item['ttl'] = (Math.floor(+new Date() / 1000) + TTL_DELTA).toString();
    item['lambdaRequestId'] = context.awsRequestId;

    let url = new URL(record.dynamodb.NewImage.apiUrl.S);
    
    try{
        const dnsLookup = lookupPromise(url.hostname);
        const dnsResolution4 = resolve4Promise(url.hostname);
        const dnsResolution6 = resolve6Promise(url.hostname);
        const dnsResolutionAny = resolveAnyPromise(url.hostname);
  
        const dataResponse = await Promise.all([dnsLookup, dnsResolution4, dnsResolution6, dnsResolutionAny]);
        item['lookup'] = dataResponse[0];
        item['resolve4'] = dataResponse[1];
        item['resolve6'] = dataResponse[2];
        item['resolveAny'] = dataResponse[3];
    }catch(err){
        console.error(err);
    }
  
    const params = {
      TableName: TABLE_NAME,
      Item: item
    };
  
    try {
      await db.put(params).promise();
    } catch (dbError) {
      console.log(dbError);
    }
  }
};
