#!/opt/node/bin/node

const TABSP={
  "orcl": {
      "USERS":  1000,
      "SYSAUX": 1000,
      "SYSTEM": 1000
  }
};

const PROPS={
    zabbix: {
      "server": "zabbix.local",
      "client": "oracle-host",
    },
    oracle: {
      "nls_lang":    "AMERICAN_AMERICA.WE8MSWIN1252",
      "oracle_home": "/u00/app/oracle/product/11.2.0/dbhome_1"
    }
};

const PROG={
  opts: require('stdio').getopt({
    'discover':    {key: 'd', description: 'Print Oracle instance SID(s)'},
    'tablespaces': {key: 't', description: 'Check tablespaces and report status to Zabbix server'},
    'backups':     {key: 'b', description: 'Check Oracle backups and report to Zabbix server'},
    'statistics':  {key: 's', description: 'Get Oracle statistics and report to Zabbix server'},
    'jobs':        {key: 'j', description: 'Check Oracle jobs and report to Zabbix server'},
    'print':       {key: 'p', description: 'Print to stdout rather than send to Zabbix server'}
  }),

  /*
   * Dependencies
   */
  fs: require('fs'),
  exec: require('child_process').execSync,


  /*
   * Utility functions
   */
  min: function(a,b){
    return a < b? a: b;
  },
  fileExists: function(path) {
    try {
      this.fs.accessSync(path, this.fs.F_OK);
      return true;
    } catch (e) {
      return false;
    }
  },
  df: function(path) {
    var execSync = require('child_process').execSync;
    return JSON.parse(
      execSync("df -P --block-size=1M " + path
        + " | grep '/' | awk '{split($0,a,\" \"); print \"{\\\"dev\\\":\\\"\" a[1] \"\\\",\\\"freemb\\\":\" a[4] \"}\"}'",{encoding:"UTF-8"}
      )
    );
  },
  zabbix: function(key,val){
    this.exec('/usr/bin/zabbix_sender -z "' + PROPS.zabbix.server + '" -s "' + PROPS.zabbix.client + '" -k "' + key + '" -o "' + val +'"');
  },
  formatNumber: function(n) {
    return n.toFixed(0).replace(/(\d)(?=(\d{3})+$)/g, '$1,');
  },


  /*
   * Report Oracle instances
   */
  discover: function() {
    //var obj = {"data":[]};
    //for (var key in TABSP){
    //  obj.data.push({
    //        "{#INSTANCE}": key
    //  });
    //}
    //console.log(obj);
    var c = 0;
    console.log('{');
    console.log('"data": [');
    for (var sid in TABSP) {
      if (c++ > 0) {
        console.log(',');
      }
      console.log('{');
      console.log('"{#INSTANCE}":"' + sid + '"');
      console.log('}');
    }
    console.log(']');
    console.log('}');
  },


  /*
   * Report Oracle tablespace free (usable) space
   */
  tablespaces: function() {
    var obj = this;
    for (var sid in TABSP) {
      var text ='';
      text += 'NLS_LANG="' + PROPS.oracle.nls_lang + '"\n';
      text += 'ORACLE_HOME="' + PROPS.oracle.oracle_home + '"\n';
      text += 'ORACLE_SID="' + sid + '"\n';
      text += 'PATH=$PATH:$ORACLE_HOME/bin\n';
      text += 'export NLS_LANG ORACLE_HOME ORACLE_SID PATH\n';
      text += 'sqlplus -L -S "/ as sysdba" << EOF\n';

      text += 'set pages 0\n';
      text += 'set linesize 1000\n';
      text += 'set trimspool on\n';
      text += 'set trimout on\n';
      text += 'set wrap off\n';
      text += '--set termout off\n';
      text += 'set pagesize 0\n';
      text += 'set verify off\n';
      text += 'set long 100000\n';
      text += 'set feedback off\n';
      text += 'select decode(rownum, 1, \'\',\',\') || \'{"ts":"\'\n';
      text += ' || d.tablespace_name || \'","id":"\'\n'; 
      text += ' || d.file_id || \'","name":"\'\n';
      text += ' || d.file_name || \'","autoext":\'\n';
      text += ' || decode(d.autoextensible, \'YES\', \'true\', \'false\') || \',"mb":\'\n';
      text += ' || trunc(d.bytes / 1024 / 1024) || \',"maxmb":\'\n';
      text += ' || trunc(d.maxbytes / 1024 / 1024) || \',"freemb":\'\n';
      text += ' || nvl(trunc(s.bytes / 1024 / 1024), \'0\') || \'}\'\n';
      text += 'from\n';
      text += ' sys.dba_data_files d,\n';
      text += ' (\n';
      text += '   select file# file_id, sum(e.length * ts.blocksize) bytes\n';
      text += '   from sys.fet$ e, sys.ts$ ts\n';
      text += '   where ts.ts# = e.ts#\n';
      text += '   group by file#\n';
      text += '   union all\n';
      text += '   select file_id, sum(e.blocks * ts.blocksize) bytes\n';
      text += '   from sys.dba_lmt_free_space e, sys.ts$ ts\n';
      text += '   where ts.ts# = e.tablespace_id\n';
      text += '   group by file_id\n';
      text += ' ) s\n';
      text += 'where d.file_id = s.file_id(+)\n';
      text += '/\n';
      text += 'exit\n';
      text += 'EOF\n';

      text = obj.exec(text);
      var arr = JSON.parse('[' + text + ']');
      var ts = [];
      arr.forEach(function(d){
        var df = obj.df(d.name);
        d.dev = df.dev;
        d.devmb = df.freemb;
        if (d.ts in ts){
          ts[d.ts][d.name] = d;
        } else {
          ts[d.ts] = [];
          ts[d.ts][d.name] = d;
        }
      });

      obj.tablespace(ts,sid);
    }
  },
  tablespace: function(ts, sid) {
    var obj = this;
    var warn = false;
    var text = "";
    for (var key in TABSP[sid]) {
      var t = ts[key];
      var dev = [];
      var tresholdmb = TABSP[sid][key];
      var freemb = 0;
      for (var file in ts[key]) {
        var d = ts[key][file];
        freemb += d.freemb;
        if (d.maxmb > d.mb && d.autoext) {
          if (d.dev in dev) {
            var delta = obj.min(d.maxmb - d.mb, dev[d.dev]);
            freemb += delta;
            dev[d.dev] -= delta;
          } else {
            var delta = obj.min(d.maxmb - d.mb, d.devmb);
            freemb += delta;
            dev[d.dev] = d.devmb - delta;
          }
        }
      }

      if (tresholdmb < freemb) {
        text += "\n" + key + " OK: " + obj.formatNumber(freemb) + " MB free (min " + obj.formatNumber(tresholdmb) + " MB)";
      } else {
        warn = true;
        text += "\n" + key + " WARNING: " + obj.formatNumber(freemb) + " MB free (min " + obj.formatNumber(tresholdmb) + " MB)";
      }
    }

    if (PROG.opts.print) {
      if (warn) {
        console.log(sid + ": WARNING" + text);
      } else {
        console.log(sid + ": OK" + text);
      }
    } else {
      if (warn) {
        obj.zabbix('ora.inst.tablespace.brief[' + sid + ']', 'WARNING');
        obj.zabbix('ora.inst.tablespace[' + sid + ']', 'WARNING' + text);
      } else {
        obj.zabbix('ora.inst.tablespace.brief[' + sid + ']', 'OK');
        obj.zabbix('ora.inst.tablespace[' + sid + ']', 'OK' + text);
      }
    }
  },


  /*
   * Report Oracle backup status
   */
  backups: function() {
    var obj = this;
    for (var sid in TABSP) {
      var filesNeedBackup = obj.filesNeedBackup(sid);
      var lastBackupStatus = obj.lastBackupStatus(sid);

      var warn = false;
      var text = '';
      text += '\nLast backup details:';
      text += '\nStatus: ' + lastBackupStatus.status;
      text += '\nStart time: ' + lastBackupStatus.start_time;
      text += '\nEnd time: ' + lastBackupStatus.end_time;
      text += '\nOutput device type: ' + lastBackupStatus.output_device_type;
      text += '\nInput type: ' + lastBackupStatus.input_type;
      if (lastBackupStatus.status === "FAILED" || filesNeedBackup.length) {
        warn = true;
        if (filesNeedBackup.length) {
          text += '\n\nFiles needed to backup:';
          filesNeedBackup.forEach(function(file){text += '\n' + file;});
        }
      }
      if (PROG.opts.print) {
        if (warn) {
          console.log(sid + ": WARNING" + text);
        } else {
          console.log(sid + ": OK" + text);
        }
      } else {
        if (warn) {
          obj.zabbix('ora.inst.backup.brief[' + sid + ']', 'WARNING');
          obj.zabbix('ora.inst.backup[' + sid + ']', 'WARNING' + text);
        } else {
          obj.zabbix('ora.inst.backup.brief[' + sid + ']', 'OK');
          obj.zabbix('ora.inst.backup[' + sid + ']', 'OK' + text);
        }
      }
    }
  },
  filesNeedBackup: function(sid) {
    var obj = this;
    var text = '';
    text += 'NLS_LANG="' + PROPS.oracle.nls_lang + '"\n';
    text += 'ORACLE_HOME="' + PROPS.oracle.oracle_home + '"\n';
    text += 'ORACLE_SID="' + sid + '"\n';
    text += 'PATH=$PATH:$ORACLE_HOME/bin\n';
    text += 'export NLS_LANG ORACLE_HOME ORACLE_SID PATH\n';

    text += 'rman target / << EOF\n';
    text += 'report need backup;\n';
    text += 'exit\n';
    text += 'EOF';

    var files = [];
    var lines = obj.exec(text,{encoding:'UTF-8'}).split('\n');
    lines.forEach(function(line){
      var words = line.split(' ');
      if (words.length >= 3 && obj.fileExists(words[2])) {
        files.push(words[2]);
      }
    });
    return files;
  },
  lastBackupStatus: function(sid) {
    var obj = this;
    var text = '';
    text += 'NLS_LANG="' + PROPS.oracle.nls_lang + '"\n';
    text += 'ORACLE_HOME="' + PROPS.oracle.oracle_home + '"\n';
    text += 'ORACLE_SID="' + sid + '"\n';
    text += 'PATH=$PATH:$ORACLE_HOME/bin\n';
    text += 'export NLS_LANG ORACLE_HOME ORACLE_SID PATH\n';

    text += 'sqlplus -L -S "/ as sysdba" << EOF\n';
    text += 'set pages 0\n';
    text += 'set lines 200\n';
    text += 'set trimspool on\n';
    text += 'set verify off\n';
    text += 'set long 100000\n';
    text += 'set feedback off\n';
    text += 'select \'{"status":"\' || status || \'", "start_time": "\' ';
    text += '|| to_char(start_time, \'DD-MM-YYYY_HH24:MI:SS\') || \'", "end_time": "\'';
    text += '|| to_char(end_time, \'DD-MM-YYYY_HH24:MI:SS\') || \'", "output_device_type": "\'';
    text += '|| replace(output_device_type, \' \', \'_\') || \'", "input_type": "\'';
    text += '|| replace(input_type, \' \', \'_\') || \'"}\'\n';
    text += 'from v\\$rman_backup_subjob_details\n';
    text += 'where session_key = (\n';
    text += ' select max(session_key)\n';
    text += ' from v\\$rman_backup_subjob_details\n';
    text += ' where operation = \'BACKUP\'\n';
    text += ');\n';
    text += 'exit\n';
    text += 'EOF\n';

    text = obj.exec(text,{encoding:'UTF-8'});
    return JSON.parse(text);
  },


  /*
   * Report Oracle statistics
   */
  statistics: function() {
    for (var sid in TABSP) {
      var arr = this.stats(sid);

      if (PROG.opts.print) {
        console.log('ora.inst.logons[' + sid + ']: '    + arr['logons_cumulative']);
        console.log('ora.inst.cursors[' + sid + ']: '   + arr['opened_cursors_cumulative']);
        console.log('ora.inst.commits[' + sid + ']: '   + arr['user_commits']);
        console.log('ora.inst.rollbacks[' + sid + ']: ' + arr['user_rollbacks']);
        console.log('ora.inst.phreads[' + sid + ']: '   + arr['physical_reads']);
        console.log('ora.inst.phwrites[' + sid + ']: '  + arr['physical_writes']);
        console.log('ora.inst.received[' + sid + ']: '  + arr['bytes_received_via_SQL*Net_from_client']);
        console.log('ora.inst.sent[' + sid + ']: '      + arr['bytes_sent_via_SQL*Net_to_client']);
      } else {
        this.zabbix('ora.inst.logons[' + sid + ']',    arr['logons_cumulative']);
        this.zabbix('ora.inst.cursors[' + sid + ']',   arr['opened_cursors_cumulative']);
        this.zabbix('ora.inst.commits[' + sid + ']',   arr['user_commits']);
        this.zabbix('ora.inst.rollbacks[' + sid + ']', arr['user_rollbacks']);
        this.zabbix('ora.inst.phreads[' + sid + ']',   arr['physical_reads']);
        this.zabbix('ora.inst.phwrites[' + sid + ']',  arr['physical_writes']);
        this.zabbix('ora.inst.received[' + sid + ']',  arr['bytes_received_via_SQL*Net_from_client']);
        this.zabbix('ora.inst.sent[' + sid + ']',      arr['bytes_sent_via_SQL*Net_to_client']);
      }
    }
  },
  stats: function(sid) {
    var obj = this;
    var text = '';
    text += 'NLS_LANG="' + PROPS.oracle.nls_lang + '"\n';
    text += 'ORACLE_HOME="' + PROPS.oracle.oracle_home + '"\n';
    text += 'ORACLE_SID="' + sid + '"\n';
    text += 'PATH=$PATH:$ORACLE_HOME/bin\n';
    text += 'export NLS_LANG ORACLE_HOME ORACLE_SID PATH\n';

    text += 'sqlplus -L -S "/ as sysdba" << EOF\n';
    text += 'set pages 0\n';
    text += 'set lines 200\n';
    text += 'set trimspool on\n';
    text += 'set verify off\n';
    text += 'set long 100000\n';
    text += 'set feedback off\n';
    text += 'select decode(rownum,1,\'\',\',\') || \'"\' || replace(name,\' \',\'_\') || \'":\' || to_char(value) from v\\$sysstat;\n';
    text += 'exit\n';
    text += 'EOF\n';

    text = obj.exec(text,{encoding:'UTF-8'});
    return JSON.parse('{' + text + '}');
  },

  /*
   * Report Oracle jobs status
   */
  jobs: function() {
    for (var sid in TABSP) {
      this.job_statuses(sid);
    }
  },
  job_statuses: function(sid) {
    var obj = this;
    var text = '';
    text += 'NLS_LANG="' + PROPS.oracle.nls_lang + '"\n';
    text += 'ORACLE_HOME="' + PROPS.oracle.oracle_home + '"\n';
    text += 'ORACLE_SID="' + sid + '"\n';
    text += 'PATH=$PATH:$ORACLE_HOME/bin\n';
    text += 'export NLS_LANG ORACLE_HOME ORACLE_SID PATH\n';

    text += 'sqlplus -L -S "/ as sysdba" << EOF\n';
    text += 'set pages 0\n';
    text += 'set lines 1000\n';
    text += 'set trimspool on\n';
    text += 'set verify off\n';
    text += 'set long 100000\n';
    text += 'set feedback off\n';
    text += 'select decode(rownum, 1, \'\',\',\') || \'{"job":"\' || owner || \'.\' || job_name || \'", "log_date":"\'';
    text += ' || log_date || \'", "status":"\' || status || \'", "additional_info":"\'';
    text += ' || nvl(replace(replace(additional_info,\'"\',\'\\"\'), chr(10), \'\\n\'),\'\') || \'"}\'\n';
    text += 'from dba_scheduler_job_run_details\n';
    text += 'where log_date > sysdate - 1 and status = \'FAILED\'\n';
    text += '/\n';
    text += 'exit\n';
    text += 'EOF\n';

    text = obj.exec(text,{encoding:'UTF-8'});
    var arr = JSON.parse('[' + text + ']');
    text = '';
    arr.forEach(function(job){
      text += '\n' + job.job + ':';
      text += '\nStatus: ' + job.status;
      text += '\nDate: ' + job.log_date;
      text += '\nInfo: ' + job.additional_info.trim();
    });

    if (PROG.opts.print) {
      if (arr.length) {
        console.log(sid + ": WARNING" + text);
      } else {
        console.log(sid + ": OK" + text);
      } 
    } else {
      if (arr.length) {
        obj.zabbix('ora.inst.jobs.brief[' + sid + ']', 'WARNING');
        obj.zabbix('ora.inst.jobs[' + sid + ']', 'WARNING' + text);
      } else {
        obj.zabbix('ora.inst.jobs.brief[' + sid + ']', 'OK');
        obj.zabbix('ora.inst.jobs[' + sid + ']', 'OK' + text);
      }
    }
  }
};

if (PROG.opts.discover) {
  PROG.discover();
} else if (PROG.opts.tablespaces) {
  PROG.tablespaces();
} else if (PROG.opts.backups) {
  PROG.backups();
} else if (PROG.opts.statistics) {
  PROG.statistics();
} else if (PROG.opts.jobs) {
  PROG.jobs();
} else {
  PROG.opts.printHelp();
}
