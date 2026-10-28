'use strict';
const fs=require('node:fs');
const path=require('node:path');

// Product's two-device configuration, using the GAR hardware CSV headers.
function readCsv(file){
  const text=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');
  const rows=[];let row=[],value='',quoted=false,afterQuote=false;
  for(let i=0;i<=text.length;i++){
    const char=text[i];
    if(quoted){
      if(char===undefined)throw new Error(`Unclosed CSV field: ${file}`);
      if(char==='"'){if(text[i+1]==='"'){value+='"';i++;}else{quoted=false;afterQuote=true;}}
      else value+=char;
    }else if(char===','||char==='\n'||char==='\r'||char===undefined){
      row.push(value.trim());value='';afterQuote=false;
      if(char!==','){
        if(row.some(Boolean))rows.push(row);row=[];
        if(char==='\r'&&text[i+1]==='\n')i++;
      }
    }else if(char==='"'&&!value&&!afterQuote)quoted=true;
    else {if(afterQuote&&!/\s/.test(char))throw new Error(`Invalid CSV field: ${file}`);value+=char;}
  }
  const headers=rows.shift();
  if(!headers||new Set(headers).size!==headers.length)throw new Error(`Invalid CSV headers: ${file}`);
  return rows.map(values=>{
    if(values.length!==headers.length)throw new Error(`CSV column count mismatch: ${file}`);
    return Object.fromEntries(headers.map((key,index)=>[key,values[index]]));
  });
}
function integer(value,min,max,label){
  if(!/^\d+$/.test(value||'')||!Number.isSafeInteger(Number(value))||Number(value)<min||Number(value)>max)throw new Error(`Invalid ${label} in hardware CSV`);
  return Number(value);
}
function loadHardware(directory){
  const gpio=readCsv(path.join(directory,'gpio.csv')),spi=readCsv(path.join(directory,'spi.csv'));
  const mapping=new Map();
  for(const entry of gpio){if(mapping.has(entry.name))throw new Error('Duplicate GPIO name');mapping.set(entry.name,entry);}
  function line(name,direction){
    const entry=mapping.get(name);
    if(!entry||entry.direction!==direction||!/^\/dev\/gpiochip\d+$/.test(entry.chip))throw new Error(`Invalid ${name} GPIO configuration`);
    return {chip:entry.chip,line:integer(entry.line,0,4095,name)};
  }
  const dc=line('lcd_dc','output');
  const rotary=['encoder_a','encoder_b','encoder_sw'].map(name=>line(name,'input'));
  if(new Set(rotary.map(entry=>entry.chip)).size!==1||new Set(rotary.map(entry=>entry.line)).size!==3)throw new Error('Rotary requires three distinct lines on one GPIO chip');
  if(rotary.some(entry=>entry.chip===dc.chip&&entry.line===dc.line))throw new Error('LCD DC conflicts with rotary input');
  const displays=spi.filter(entry=>entry.name==='display');
  if(displays.length!==1||displays[0].driver!=='gc9a01'||!/^\/dev\/spidev\d+\.\d+$/.test(displays[0].dev))throw new Error('Invalid display SPI configuration');
  const display=displays[0],bus=integer(display.bus,0,255,'SPI bus'),cs=integer(display.chip_select,0,255,'SPI chip select');
  if(display.dev!==`/dev/spidev${bus}.${cs}`||display.mode!=='0')throw new Error('SPI path/bus/CS must agree and mode must be 0');
  return {
    display:{spi:display.dev,chip:dc.chip,dc:dc.line,hz:integer(display.max_speed_hz,1,100000000,'SPI speed')},
    rotary:{chip:rotary[0].chip,clock:rotary[0].line,data:rotary[1].line,switch:rotary[2].line},
  };
}
if(require.main===module){
  try{
    const hardware=loadHardware(process.env.GAR_HARDWARE_DIR||path.resolve(__dirname,'../hardware'));
    const args=process.argv.slice(2),field=args[1];
    if(args.length!==2||args[0]!=='--value'||!['spi','chip','dc','hz'].includes(field))throw new Error('Usage: node application/hardware.cjs --value spi|chip|dc|hz');
    console.log(hardware.display[field]);
  }catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={loadHardware};
