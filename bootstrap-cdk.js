#!/usr/bin/env node
const { exec } = require("child_process");

async function compileConfig(){
    return new Promise((resolve, reject) => {
      exec("tsc hackathon-config.ts", async (error, stdout, stderr) => {
        if (error) {
          console.log(`error: ${error.message}`);
          return;
        }
        if (stderr) {
          console.log(`stderr: ${stderr}`);
          return;
        }
        resolve();
      });
   });
};

async function bootstrapCDK(script, region){
    return new Promise((resolve, reject) => {
      exec("cdk bootstrap --app \"npx ts-node " + script +"\" aws://" + process.env.CDK_DEFAULT_ACCOUNT + "/" + region, (error, stdout, stderr) => {
        if (error) {
          console.log(`error: ${error.message}`);
        }
        if (stderr) {
          console.log(`stderr: ${stderr}`);
        }
        resolve(region);
      });
   });
};

async function processBootstrap() {

  if(process.env.CDK_DEFAULT_ACCOUNT === undefined) {
    console.log("ERROR: CDK_DEFAULT_ACCOUNT environment variable not set.");
    process.exit(1);
  }
  else {
    let scriptArgs = process.argv.slice(2)
    if(scriptArgs.length < 1) {
      console.log("ERROR: Missing argument for the path to the CDK app.");
      process.exit(1);
    }
    else {
      // compile the typescript to javascript for importing the config regions
      const configCompile = compileConfig();
      const results = await Promise.all([configCompile]);

      const { hackathonConfig } = require("./hackathon-config"); 

      console.log(hackathonConfig.replicationRegions.length);
      console.log(hackathonConfig.replicationRegions);

      for (let i = 0; i < hackathonConfig.replicationRegions.length; i++) {
        console.log("Bootstraping " + scriptArgs[0] + " in region " + hackathonConfig.replicationRegions[i]);
        const bootstrapInit = bootstrapCDK(scriptArgs[0], hackathonConfig.replicationRegions[i]);
        const bootstrapResults = await Promise.all([bootstrapInit]);
        console.log(bootstrapResults[0] + " region complete");
      };
    }
  }
}

processBootstrap();
