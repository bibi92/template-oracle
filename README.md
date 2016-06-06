# Template Oracle Database for Zabbix

To use the template you first have to setup your Zabbix server and configure your Oracle host to run oracle.js script

## Setup Zabbix server

To import the template in Zabbix navigate to **Configuration -> Templates** and press Import button, find the file **zbx_export_templates.xml** and import. Select your Oracle host and click **Templates** then link to the template and press **Update**. You will need to "discover" your Oracle instance with Zabbix to start collecting data from your Oracle host.

## Setup Oracle host

**oracle.js** was tested with *Oracle Linux 6*, but will most likely work with other Linux distributions that have *BASH* as a default command-line interpreter. **oracle.js** relies upon *execSync*, which requires *nodejs* version 0.12 or later. *EPEL* yum repository contains nodejs version 0.10, so you will have to download the distribution from https://nodejs.org/en/download/ and install manually. **oracle.js** assumes that nodejs runtime is **/opt/node/bin/node**. Nodejs installation is quite simple: just download and unpack.

**oracle.js** also uses *stdio* module to parse command-line arguments. To install stdio run:
```
sudo /opt/node/bin/npm install stdio
```
You will need Zabbix agent to communicate with your Zabbix server. To install run the command:
```
sudo yum install zabbix-agent zabbix-sender
```
To configure **oracle.js** for your environment you will have make some changes to the script:
```
const PROPS={
    zabbix: {
      "server": "your-zabbix-server-address",
      "client": "your-oracle-host-name",
    },
    oracle: {
      "nls_lang":    "AMERICAN_AMERICA.WE8MSWIN1252",
      "oracle_home": "/u00/app/oracle/product/11.2.0/dbhome_1"
    }
};
```
Change *server* attribute to your Zabbix server address (domain or IP); change *client* to the name of your Oracle host as known by Zabbix. Change *nls_lang* to match your OS settings, and *oracle_home* to your Oracle home directory.

You will also need to configure your databases' SID and tablespace free space requirements.
```
const TABSP={
  "orcl": {
      "USERS":  1000,
      "SYSAUX": 1000,
      "SYSTEM": 1000
  }
};
```
Change *orcl* to your SID and change free space treshold from 1000 MB to whatever is best for your environment. It is assumed that the script is located in */opt/zabbix* folder. Run the following commands to check if it is working:
```
/opt/zabbix/oracle.js -d
/opt/zabbix/oracle.js -p 
/opt/zabbix/oracle.js -p 
/opt/zabbix/oracle.js -p 
