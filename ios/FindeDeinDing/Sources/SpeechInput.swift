import Foundation
import Speech
import AVFoundation
import AudioToolbox
@MainActor final class SpeechInput:ObservableObject {
 @Published var isRecording=false
 @Published var transcript=""
 @Published var error:String?
 private let engine=AVAudioEngine()
 private var request:SFSpeechAudioBufferRecognitionRequest?
 private var task:SFSpeechRecognitionTask?
 private var tapInstalled=false
 private var prefix=""
 func start(existing:String){guard !isRecording else{return};error=nil;Task{let speech=await withCheckedContinuation{continuation in SFSpeechRecognizer.requestAuthorization{continuation.resume(returning:$0)}};let microphone=await withCheckedContinuation{continuation in AVAudioSession.sharedInstance().requestRecordPermission{continuation.resume(returning:$0)}};guard speech == .authorized,microphone else{error="Bitte erlaube Mikrofon und Spracherkennung in den Geräteeinstellungen.";return};guard let recognizer=SFSpeechRecognizer(locale:Locale(identifier:"de-DE")),recognizer.isAvailable else{error="Spracherkennung ist gerade nicht verfügbar.";return};guard recognizer.supportsOnDeviceRecognition else{error="Die deutsche Offline-Spracherkennung ist auf diesem Gerät noch nicht verfügbar. Bitte nutze die Texteingabe.";return};do{try AVAudioSession.sharedInstance().setCategory(.record,mode:.measurement,options:.duckOthers);try AVAudioSession.sharedInstance().setActive(true,options:.notifyOthersOnDeactivation);let r=SFSpeechAudioBufferRecognitionRequest();r.shouldReportPartialResults=true;r.requiresOnDeviceRecognition=true;r.addsPunctuation=true;r.contextualStrings=["Clara","Finde dein Ding","Klarheitsanalyse","Markus","Coaching"];prefix=existing;request=r;let input=engine.inputNode;input.installTap(onBus:0,bufferSize:1024,format:input.outputFormat(forBus:0)){buffer,_ in r.append(buffer)};tapInstalled=true;engine.prepare();try engine.start();isRecording=true;AudioServicesPlaySystemSound(1113);task=recognizer.recognitionTask(with:r){[weak self] result,failure in Task{@MainActor in guard let self=self else{return};if let result=result{self.transcript=[self.prefix,result.bestTranscription.formattedString].filter{!$0.isEmpty}.joined(separator:" ");if result.isFinal{self.stop()}};if failure != nil{self.stop()}}}}catch{self.error="Die Aufnahme konnte nicht gestartet werden.";stop()}}}
 func stop(){let wasRecording=isRecording;engine.stop();if tapInstalled{engine.inputNode.removeTap(onBus:0);tapInstalled=false};request?.endAudio();task?.cancel();task=nil;request=nil;isRecording=false;try? AVAudioSession.sharedInstance().setActive(false,options:.notifyOthersOnDeactivation);if wasRecording{AudioServicesPlaySystemSound(1114)}}
}
