'use strict';
const {loadEffects}=require('../application/effect-config.cjs');
const {SpeechOutput}=require('../application/speech-output.cjs');
async function main(){
  if(!process.env.GAR_HARDWARE_DIR)throw new Error('GAR_HARDWARE_DIR must select the Product CSV directory');
  const config=loadEffects(process.env.GAR_HARDWARE_DIR).speech;
  if(!config)throw new Error('Enable the speech row in the Product effects.csv first');
  const voice=new SpeechOutput(config);
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>voice.close());
  await voice.say(process.argv.slice(2).join(' '));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
