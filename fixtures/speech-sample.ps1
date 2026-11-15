param([string]$OutputPath)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Speech
$synth=[System.Speech.Synthesis.SpeechSynthesizer]::new()
try{
 $voice=$synth.GetInstalledVoices() | Where-Object {$_.VoiceInfo.Culture.Name -eq 'zh-CN'} | Select-Object -First 1
 if(-not $voice){throw 'No installed Chinese synthesis voice'}
 $synth.SelectVoice($voice.VoiceInfo.Name)
 $format=[System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(16000,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono)
 $synth.SetOutputToWaveFile($OutputPath,$format)
 $synth.Speak('你好，我们来测试语音识别。')
}finally{$synth.Dispose()}
