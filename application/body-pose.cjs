'use strict';

/** Accept a stated current pose; bare commands and uncertain reports are unknown. */
function reportedPose(text){
  if(typeof text!=='string')return null;
  const value=text.normalize('NFKC').replace(/[\s、。,.！!]/g,'');
  if(/ない|ません|じゃ|では|かな|かも|多分|たぶん|以前|さっき|さきほど|だった|でした|たら|なら|[？?]|ですか|ますか|るか/.test(value))return null;
  const stand=/(?:立|た)って(?:いる|います|る)|立ち姿勢|立った状態/.test(value);
  const lie=/(?:伏|ふ)せて(?:いる|います|る)|伏せ姿勢|伏せた状態/.test(value);
  return stand===lie?null:stand?'stand':'lie';
}
module.exports={reportedPose};
