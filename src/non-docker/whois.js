const whois = require('whois')
const AWS = require('aws-sdk');
const dns = require('dns');

const db = new AWS.DynamoDB.DocumentClient();

const TABLE_NAME = process.env.TABLE_NAME || '';
const PRIMARY_KEY = process.env.PRIMARY_KEY || '';
const SORT_KEY = process.env.SORT_KEY || '';

// whois keys
const registrarKey = 'registrar';
const domainNameKey = 'domainName';
const registrantKey = 'registrant';
const adminKey = 'admin';
const techKey = 'tech';
const nameServerKey = 'nameServer';
const dnsSecKey = 'dnsSec';
const whoisUpdateKey = 'WHOIS';

// whois values
const registrar = ['Registry Domain ID', 'Registrar WHOIS Server', 'Registrar URL', 'Updated Date', 'Creation Date', 'Registrar Registration Expiration Date', 'Registrar', 'Registrar IANA ID','Registrar Abuse Contact Email', 'Registrar Abuse Contact Phone', 'Reseller', 'Registry Admin ID','Registry Tech ID', 'Registry Registrant ID'];
const domainName = ['Domain Name','Domain Status'];
const registrant = ['Registrant Name', 'Registrant Organization', 'Registrant Street', 'Registrant City', 'Registrant State/Province', 'Registrant Postal Code', 'Registrant Country','Registrant Phone', 'Registrant Phone Ext', 'Registrant Fax', 'Registrant Fax Ext', 'Registrant Email'];
const admin = ['Admin Name', 'Admin Organization', 'Admin Street', 'Admin City','Admin State/Province','Admin Postal Code','Admin Country','Admin Phone','Admin Phone Ext','Admin Fax','Admin Fax Ext','Admin Email'];
const tech = ['Tech Name','Tech Organization','Tech Street','Tech City','Tech State/Province','Tech Postal Code','Tech Country','Tech Phone','Tech Phone Ext','Tech Fax','Tech Fax Ext','Tech Email'];
const nameServers = ['Name Server'];
const dnsSec = ['DNSSEC'];
const whoisUpdate = ['>>> Last update of WHOIS database'];


const RESERVED_RESPONSE = `Error: You're using AWS reserved keywords as attributes`,
  DYNAMODB_EXECUTION_ERROR = `Error: Execution update, caused a Dynamodb error, please take a look at your CloudWatch Logs.`;

async function whoisLookup(domain){
  return new Promise((resolve, reject) => {
    whois.lookup(domain, function(err, data) {
      let result = {};
      let cleaned = data.split(/\r?\n/)
      cleaned.forEach(function(value, index) {
        let strAry = value.split(":");

        // registrar info
        if (registrar.indexOf(strAry[0])>= 0) {
          if (!result.hasOwnProperty(registrarKey)) {
            result[registrarKey] = {};
          }
          result[registrarKey][strAry[0]] = strAry.slice(1).join('').replace(/\s+/g, " ").replace(/^\s|\s$/g, "");
        }

        // domain name info
        if (domainName.indexOf(strAry[0])>= 0) {
          if (!result.hasOwnProperty(domainNameKey)) {
            result[domainNameKey] = {};
          }

          if (strAry[0] === "Domain Status") {
            if (!result[domainNameKey].hasOwnProperty("status")) {
              result[domainNameKey]["status"] = [];
            }

            let spaceSeperation = strAry.slice(1).join('').replace(/\s+/g, " ").replace(/^\s|\s$/g, "").split(" ");
            let temp = {};
            temp["code"] = spaceSeperation[0];
            temp["ref"] = spaceSeperation.slice(1).join("");
            result[domainNameKey]["status"].push(temp);
          } else {
            if (!result.hasOwnProperty(domainNameKey)) {
              result[domainNameKey] = {};
            }

            result[domainNameKey][strAry[0]] = strAry.slice(1).join('').replace(/\s+/g, " ").replace(/^\s|\s$/g, "");
          }
        }

        // registrant info
        if (registrant.indexOf(strAry[0])>= 0) {
          if (!result.hasOwnProperty(registrantKey)) {
            result[registrantKey] = {};
          }
          result[registrantKey][strAry[0]] = strAry.slice(1).join('').replace(/\s+/g, " ").replace(/^\s|\s$/g, "");
        }

        // admin info
        if (admin.indexOf(strAry[0])>= 0) {
          if (!result.hasOwnProperty(adminKey)) {
            result[adminKey] = {};
          }
          result[adminKey][strAry[0]] = strAry.slice(1).join('').replace(/\s+/g, " ").replace(/^\s|\s$/g, "");
        }
  
        // tech info
        if (tech.indexOf(strAry[0])>= 0) {
          if (!result.hasOwnProperty(techKey)) {
            result[techKey] = {};
          }
          result[techKey][strAry[0]] = strAry.slice(1).join('').replace(/\s+/g, " ").replace(/^\s|\s$/g, "");
        }
  
        // name servers info
        if (nameServers.indexOf(strAry[0])>= 0) {
          if (!result.hasOwnProperty(nameServerKey)) {
            result[nameServerKey] = [];
          }
          result[nameServerKey].push(strAry.slice(1).join('').replace(/\s+/g, " ").replace(/^\s|\s$/g, ""));
        }

        // dns sec info
        if (dnsSec.indexOf(strAry[0])>= 0) {
          if (!result.hasOwnProperty(dnsSecKey)) {
            result[dnsSecKey] = {};
          }
          result[dnsSecKey][strAry[0]] = strAry.slice(1).join('').replace(/\s+/g, " ").replace(/^\s|\s$/g, "");
        }
 
        if(whoisUpdate.indexOf(strAry[0])>=0) {
          if (!result.hasOwnProperty(whoisUpdateKey)) {
            result[whoisUpdateKey] = {};
          }
          result[whoisUpdateKey]["lastUpdate"] = strAry.slice(1).join('').replace(/\s+/g, " ").replace(/^\s|\s$|</g, "");
        }
    
      });
    
      resolve(result);
    });
  });
};

exports.handler = async (event, context) => {
  for (const record of event.Records) {
    let url = new URL(record.dynamodb.NewImage.apiUrl.S);

    const whoisPromise = whoisLookup(url.hostname);
    const dataResponse = await Promise.all([whoisPromise]);

    let item = {};
    const TTL_DELTA = 60 * 60 * 24 * 2; // Keep records for 2 days
    item[PRIMARY_KEY] = record.dynamodb.NewImage.initId.S;
    item[SORT_KEY] = 'whois';
    item['regionFunction'] = process.env.AWS_REGION;
    item['createdAt'] = (Math.floor(+new Date() / 1000)).toString();
    item['ttl'] = (Math.floor(+new Date() / 1000) + TTL_DELTA).toString();
    item['lambdaRequestId'] = context.awsRequestId;
    item['whois'] = dataResponse[0];;

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
