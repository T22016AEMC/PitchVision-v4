// The owner's two clips (files live in ../test videos and are never committed) and what is known about them.
// Marks are the owner's: release = first frame the ball is off the hand, glove = first frame at the net (initial values only).
export const REAL_CLIPS=[
  {name:'straight-720p',file:'直球.mp4',view:'pitcher_rear',release:127,glove:139,speedClaimKmh:[120,120],pitch:'straight',pitchType:'四縫線直球 (Fastball)'},
  {name:'straight-4k',file:'直球.mov',view:'pitcher_rear',release:127,glove:139,speedClaimKmh:[120,120],pitch:'straight',pitchType:'四縫線直球 (Fastball)'},
  {name:'knuckle-720p',file:'彈指曲球.mp4',view:'pitcher_rear',release:97,glove:111,speedClaimKmh:[95,100],pitch:'knuckle',pitchType:'彈指曲球 (Knuckle Curve)'},
  {name:'knuckle-4k',file:'彈指曲球.mov',view:'pitcher_rear',release:97,glove:111,speedClaimKmh:[95,100],pitch:'knuckle',pitchType:'彈指曲球 (Knuckle Curve)'}
];
