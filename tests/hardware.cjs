const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {loadHardware}=require('../application/hardware.cjs');

function fixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'garmyfriend-hardware-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  fs.writeFileSync(path.join(directory,'gpio.csv'),
    'name,chip,line,direction,role,active,initial,pull,sim_control,description\r\n'+
    'lcd_dc,/dev/gpiochip3,8,output,display_ctrl,high,0,,,"LCD, DC"\r\n'+
    'encoder_a,/dev/gpiochip3,1,input,encoder,high,,pull-up,,"KY-040, CLK"\r\n'+
    'encoder_b,/dev/gpiochip3,2,input,encoder,high,,pull-up,,"KY-040\r\nDT"\r\n'+
    'encoder_sw,/dev/gpiochip3,3,input,button,low,,pull-up,,"Push ""switch"""\r\n');
  fs.writeFileSync(path.join(directory,'spi.csv'),
    'name,bus,chip_select,dev,mode,max_speed_hz,driver,sim,description\n'+
    'display,2,1,/dev/spidev2.1,0,2000000,gc9a01,gc9a01,Test display\n');
  return directory;
}
test('GAR CSV values select nondefault GPIO/SPI wiring, including quoted descriptions',t=>{
  assert.deepEqual(loadHardware(fixture(t)),{
    display:{spi:'/dev/spidev2.1',chip:'/dev/gpiochip3',dc:8,hz:2000000},
    rotary:{chip:'/dev/gpiochip3',clock:1,data:2,switch:3,bias:'pull-up'},
  });
});

test('physical reset and input bias come from CSV and cannot share a pin',t=>{
  const directory=fixture(t),gpio=path.join(directory,'gpio.csv');
  const rows=fs.readFileSync(gpio,'utf8')+'lcd_rst,/dev/gpiochip3,9,output,display_ctrl,high,1,,,Reset\n';
  fs.writeFileSync(gpio,rows);
  assert.equal(loadHardware(directory).display.reset,9);
  assert.equal(loadHardware(directory).rotary.bias,'pull-up');
  fs.writeFileSync(gpio,rows.replace('gpiochip3,9,output','gpiochip3,1,output'));
  assert.throws(()=>loadHardware(directory),/reset conflicts/);
  fs.writeFileSync(gpio,rows.replace('gpiochip3,9,output','gpiochip3,8,output'));
  assert.throws(()=>loadHardware(directory),/reset requires/);
  fs.writeFileSync(gpio,rows.replace('pull-up','unsupported'));
  assert.throws(()=>loadHardware(directory),/bias/);
});
test('conflicting, incomplete and inconsistent CSV assignments fail before device access',t=>{
  const directory=fixture(t),gpio=path.join(directory,'gpio.csv'),spi=path.join(directory,'spi.csv');
  const goodGpio=fs.readFileSync(gpio,'utf8'),goodSpi=fs.readFileSync(spi,'utf8');
  for(const invalid of [goodGpio.replace('gpiochip3,1,input','gpiochip3,8,input'),goodGpio.replace('gpiochip3,2,input','gpiochip3,1,input'),goodGpio.replace('encoder_a,','missing_a,'),goodGpio.replace('gpiochip3,8,output','gpiochip3,unknown,output')]){
    fs.writeFileSync(gpio,invalid);assert.throws(()=>loadHardware(directory));
  }
  fs.writeFileSync(gpio,goodGpio);
  fs.writeFileSync(spi,goodSpi.replace('spidev2.1','spidev0.0'));assert.throws(()=>loadHardware(directory),/path\/bus\/CS/);
  fs.writeFileSync(spi,goodSpi.replace('2000000','0'));assert.throws(()=>loadHardware(directory),/speed/);
});

test('optional kernel debounce comes from CSV and rejects invalid or mixed periods',t=>{
  const directory=fixture(t),gpio=path.join(directory,'gpio.csv');
  const original=fs.readFileSync(gpio,'utf8');
  // This fixture contains quoted newlines, so append the optional column before
  // the quoted descriptions rather than splitting its records by newline.
  const withPeriod=value=>original.replace('sim_control,description','sim_control,debounce_us,description')
    .replace('0,,,"LCD','0,,,,"LCD').replaceAll('pull-up,,"',`pull-up,,${value},"`);
  fs.writeFileSync(gpio,withPeriod('1000'));
  assert.equal(loadHardware(directory).rotary.debounceUs,1000);
  fs.writeFileSync(gpio,withPeriod('0'));
  assert.equal(loadHardware(directory).rotary.debounceUs,undefined);
  for(const value of ['-1','1.5','1000001','bad']){
    fs.writeFileSync(gpio,withPeriod(value));
    assert.throws(()=>loadHardware(directory),/debounce/);
  }
  fs.writeFileSync(gpio,withPeriod('1000').replace('pull-up,,1000','pull-up,,2000'));
  assert.throws(()=>loadHardware(directory),/one debounce period/);
  fs.writeFileSync(gpio,original);
  assert.equal(loadHardware(directory).rotary.debounceUs,undefined);
});
