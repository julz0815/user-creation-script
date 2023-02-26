import * as fs from 'fs';
import csvParser from 'csv-parser';
import * as _ from 'lodash';
//import * as axios from 'axios'
import axios, { AxiosResponse, AxiosError } from 'axios';
import { slice } from 'lodash';
const auth = require("./auth");
var call:any = ''
var apiCall:any = ''
var payload:any = ''

interface DataItem {
  firstname: string;
  lastname: string;
  email: string;
  reponame: string;
}

interface MyApiResponse {
  call: any;
  page: any;
  _embedded: any;
  teams: any;
  return: any;
  response: any;
  status: any;
  error: any;

}


type GroupedData = Record<string, DataItem[]>;

async function groupByColumn(filePath: string, columnName: keyof DataItem): Promise<GroupedData> {
  const data: DataItem[] = [];
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csvParser({ separator: ';' }))
      .on('data', (row) => {
        const item: DataItem = {
          firstname: row['firstname'],
          lastname: row['lastname'],
          email: row['email'],
          reponame: row['reponame'],
        };
        data.push(item);
      })
      .on('end', () => {
        const groupedData: GroupedData = {};
        for (const item of data) {
          const key = item[columnName];
          if (groupedData[key]) {
            groupedData[key].push(item);
          } else {
            groupedData[key] = [item];
          }
        }
        resolve(groupedData);
      })
      .on('error', (error) => {
        reject(error);
      });
  });
}

console.log('\n\n####### CHECK THE USER TO BE SETUP ######')
groupByColumn('./users.csv', 'email')
  .then(async (groupedData) => {
    var usersCount = Object.keys(groupedData).length
    console.log(groupedData);
    console.log('\n\n####### FOUND '+usersCount+' USER RECORDS TO PROCESS')

    for (const key in groupedData) {
      if (groupedData.hasOwnProperty(key)) {
        const group = groupedData[key];
        // check if user already exist on the Veracode platform
        console.log(`\n- User to check ${key}:`);

        var apiCall = '/api/authn/v2/users?user_name='+key
        call = await findUser(apiCall)

        if ( call.page.total_elements == 1 ){
          console.log('-- User '+key+' already exists - lets check the teams')
          var userId = call._embedded.users[0].user_id
          apiCall = '/api/authn/v2/users/'+userId
          call = await findUser(apiCall)
          console.log('--- Teams the user '+userId+' is setup for:')
          var teamsOnFile:any = call.teams
          var teamsCount = call.teams.length

          //display the team names found on the Veracode Platform
          for ( var i = 0; i < teamsCount; i++){
            console.log('---- Team Name: '+call.teams[i].team_name)
          }

          var teamFound = 0
          var userTeams = 0

          //setup the teams on the Veracode Platform, as we don't knwo they exist or not. Will return "undefined" if the team already exists. 
          for (const item of group) {
            console.log('---- trying to setup team ('+item.reponame+'), just in case it doesn\'t exits')
            apiCall = '/api/authn/v2/teams'
            var payload = '{"team_name":"'+item.reponame+'"}'
            call = await createTeam(apiCall,payload)
            if ( call == 'team exists' ){
              console.log('----- Team '+item.reponame+' already exists on the Veracode Platform -> no need to create')
            }
            else {
              console.log('----- Team '+item.reponame+' didn\'t exist on the Veracode Platform and was created')
            }

            //count the teams the user needs access to
            userTeams++
            //match the teams the user already has access to
            if (teamsOnFile.find( ({team_name}:any) => team_name === item.reponame )){
              teamFound++
            }
          }
          console.log('--- Number of teams the user has access to: '+teamsCount)
          console.log('--- Number of teams found on account: '+teamFound)
          console.log('--- Number of teams the user needs access to: '+userTeams)

          if ( teamsCount < userTeams ){
            console.log('--- Teams mismatch -> user needs update')

            //create JSON payload
            var payload = ''
            for (const item of group) {
              payload += '{"team_name":"'+item.reponame+'"},'

            }
            //remove last , and the end
            payload = payload.slice(0, -1)
            var payloadFull = '{"teams":['+payload+']}'
            apiCall = '/api/authn/v2/users/'+userId+'?partial=true'
            call = await updateUser(apiCall,payloadFull)
            if ( call != null ){
              console.log('--- Teams for user '+userId+' have successfully been updated')
            }
          }
          else {
            console.log('--- User '+userId+' is already setup correctly -> nothing to change')
          }


        }
        else if ( call.page.total_elements == 0 ){
          console.log('-- User '+key+' doesnt exists - lets create them')

          //first try to create the teams for the user
          for (const item of group) {
            console.log('---- trying to setup team ('+item.reponame+'), just in case it doesn\'t exits')
            apiCall = '/api/authn/v2/teams'
            var payload = '{"team_name":"'+item.reponame+'"}'
            call = await createTeam(apiCall,payload)
            if ( call == 'team exists' ){
              console.log('----- Team '+item.reponame+' already exists on the Veracode Platform -> no need to create')
            }
            else {
              console.log('----- Team '+item.reponame+' didn\'t exist on the Veracode Platform and was created')
            }
          }

          //console.log(group)
          var payload:string = '' 
          for (const item of group) {
            //creating the team payload for the user creation
            payload += '{"team_name":"'+item.reponame+'"},'
          }

          //create full payload for user creation
          payload = payload.slice(0, -1)
          var userCreationPayload:string = `{
            "email_address":"${group[0].email}",
            "first_name":"${group[0].firstname}",
            "last_name":"${group[0].lastname}",
            "ip_restricted":false,
            "pin_required": true,
            "active":true,
            "roles":[
              {
                  "role_name":"submitter"
              },
              {
                  "role_name":"reviewer"
              }
            ],
            "title":"Sample",
            "user_name":"${group[0].email}",
            "userType":"VOSP",
            "teams":[${payload}]
          }`

          console.log('--- User '+key+' will be created now')
          apiCall = '/api/authn/v2/users'
          call = await createUser(apiCall, userCreationPayload)
          //console.log(call)
          if ( call.user_id != '' ){
            console.log('---- User '+key+' has been setup with user_id '+call.user_id+' on the Veracode Platform.')
          }
          else {
            console.log('---- There was a problem with setting up the user!')
          }




        }

        
      }
    }






    
  })
  .catch((error) => {
    console.error(error);
  });

async function findUser(apiCall: string): Promise<MyApiResponse> {
  var options = {
    host: auth.getHost(),
    path: apiCall,
    method: "GET"
  }
  
  return axios.get<MyApiResponse>('https://api.veracode.com'+apiCall, {
    headers:{
      'Authorization': auth.generateHeader(options.path, options.method)
    }
  })
    .then((response: AxiosResponse<MyApiResponse>) => {
      //console.log(response.data)
      return response.data;
    })
    .catch((error: AxiosError) => {
      throw new Error(error.message);
    });
}

async function updateUser(apiCall: string,payload:string): Promise<MyApiResponse> {
  var options = {
    host: auth.getHost(),
    path: apiCall,
    method: "PUT"
  }

  return axios.put<MyApiResponse>('https://api.veracode.com'+apiCall, payload, {
    headers:{
      'Content-Type': 'application/json',
      'Authorization': auth.generateHeader(options.path, options.method)
    },
  })
    .then((response: AxiosResponse<MyApiResponse>) => {
      //console.log(response)
      return response.data;
    })
    .catch((error: AxiosError) => {
      throw new Error(error.message);
    });
}

async function createTeam(apiCall: any,payload:any):Promise<any>{
  var options:any = {
    host: auth.getHost(),
    path: apiCall,
    method: "POST"
  }
  
return axios.post<MyApiResponse>('https://api.veracode.com'+apiCall, payload, {
    headers:{
      'Content-Type': 'application/json',
      'Authorization': auth.generateHeader(options.path, options.method)
    }
  })
    .then((response: AxiosResponse<MyApiResponse>) => {
      //console.log(response)
      return response.data;
    })
    .catch((error: AxiosError) => {
      //console.log(error)
      if ( error.response?.status == 400 ){
        //return error.response.status
        return ('team exists')
      }
      else{
        throw new Error(error.message);
      }
    });
}


async function createUser(apiCall: string,payload:string): Promise<MyApiResponse> {
  var options = {
    host: auth.getHost(),
    path: apiCall,
    method: "POST"
  }

  return axios.post<MyApiResponse>('https://api.veracode.com'+apiCall, payload, {
    headers:{
      'Content-Type': 'application/json',
      'Authorization': auth.generateHeader(options.path, options.method)
    },
  })
    .then((response: AxiosResponse<MyApiResponse>) => {
      //console.log(response)
      return response.data;
    })
    .catch((error: AxiosError) => {
      throw new Error(error.message);
    });
}