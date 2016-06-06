# Template Oracle Database for Zabbix

This software is MIT-licensed (https://opensource.org/licenses/MIT).

## Setup Zabbix server

To import the template in Zabbix navigate to *Configuration -> Templates* and press *Import* button, find the file **zbx_export_templates.xml** and import. Select your Oracle host and click *Templates*, then link to the template and press *Update*. You will need to "discover" your Oracle instance with Zabbix to start collecting data from your Oracle host. Default discovery period for the template is 86400 (1 day). To make it faster navigate to your host and select *Discovery rules -> Template Oracle Database: Discover Oracle Instances*, and set *Update interval (in sec)* to 60 (one minute). As a result of the discovery process items, triggers, and graphs will be added to your Oracle host.

## Setup Oracle host

**oracle.js** program is used to communicate with Oracle database and report to Zabbix server. Put it into */opt/zabbix/* folder and make executable by user *oracle*. It has the following command-line arguments:
```
    'discover':    {key: 'd', description: 'Print Oracle instance SID(s)'},
    'tablespaces': {key: 't', description: 'Check tablespaces and report status to Zabbix server'},
    'backups':     {key: 'b', description: 'Check Oracle backups and report to Zabbix server'},
    'statistics':  {key: 's', description: 'Get Oracle statistics and report to Zabbix server'},
    'jobs':        {key: 'j', description: 'Check Oracle jobs and report to Zabbix server'},
    'print':       {key: 'p', description: 'Print to stdout rather than send to Zabbix server'}
```

**oracle.js** was tested with *Oracle Linux 6*, but will most likely work with other Linux distributions that have *BASH* as a default command-line interpreter. **oracle.js** relies upon *execSync*, which requires *nodejs* version 0.12 or later. *EPEL* yum repository contains nodejs version 0.10, so you will have to download the distribution from https://nodejs.org/en/download/ and install manually. **oracle.js** assumes that nodejs runtime is **/opt/node/bin/node**. Nodejs installation is quite simple: just download and unpack.

**oracle.js** also uses *stdio* module to parse command-line arguments. To install stdio run:
```
sudo /opt/node/bin/npm install stdio
```
You will need Zabbix agent to communicate with your Zabbix server. To install run the command:
```
sudo yum install zabbix-agent zabbix-sender
```
To configure **oracle.js** for your environment you will have to make some changes to **oracle.js**:
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
Change *server* attribute to your Zabbix server address (domain or IP); change *client* to the name of your Oracle host as known by the Zabbix server. Change *nls_lang* to match your operating system settings, and *oracle_home* to your Oracle home directory.

You will also need to configure your databases' SIDs and tablespace free space requirements.
```
const TABSP={
  "orcl": {
      "USERS":  1000,
      "SYSAUX": 1000,
      "SYSTEM": 1000
  }
};
```
Change *orcl* to your SID and change free space treshold from 1000 MB to whatever is best for your environment. Run the following commands to check if it is working:
```
/opt/zabbix/oracle.js -d
/opt/zabbix/oracle.js -p -s
/opt/zabbix/oracle.js -p -j
/opt/zabbix/oracle.js -p -t
/opt/zabbix/oracle.js -p -b
```
After you have tested your setup, add the following line to the end of */etc/zabbix/zabbix_agentd.conf* file:
```
UserParameter=oracle.instances.discover,/opt/zabbix/oracle.js -d
```
Add the following to user *oracle* crontab:
```
*/10 * * * *   flock -w 0 /home/oracle/lock/oracle-zabbix-01 -c "/opt/zabbix/oracle.js -b"
* * * * *      flock -w 0 /home/oracle/lock/oracle-zabbix-02 -c "/opt/zabbix/oracle.js -s"
40 * * * *     flock -w 0 /home/oracle/lock/oracle-zabbix-03 -c "/opt/zabbix/oracle.js -t"
*/10 * * * *   flock -w 0 /home/oracle/lock/oracle-zabbix-04 -c "/opt/zabbix/oracle.js -j"
```
