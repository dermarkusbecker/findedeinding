import SwiftUI
import CoachingCore
struct AuthenticationView:View {
 @EnvironmentObject var store:AppStore
 @Environment(\.horizontalSizeClass) private var sizeClass
 @State private var identifier=""
 @State private var password=""
 @State private var error:String?
 @State private var busy=false
 @State private var register=false
 @State private var reset=false
 var body:some View {
  NavigationStack {
   ScrollView {
    VStack(alignment:.leading,spacing:24){
     Image("BrandLogo").resizable().scaledToFit().padding(24).background(Brand.navy,in:RoundedRectangle(cornerRadius:20))
     Text("Finde, was wirklich zu dir passt.").font(.largeTitle.bold())
     Text("Dein persönlicher Raum für acht Wochen Coaching mit Markus und Clara.").foregroundStyle(.secondary)
     TextField("E-Mail oder Teilnehmer-Login",text:$identifier).textContentType(.username).textInputAutocapitalization(.never).autocorrectionDisabled()
     SecureField("Passwort",text:$password).textContentType(.password).onSubmit{login()}
     InlineError(text:error)
     PrimaryButton(title:"Anmelden",busy:busy,action:login)
     Button("Passwort vergessen?"){reset=true}
     Divider()
     Button("Neu hier? Registrierung & Intake"){register=true}.font(.headline)
     Text("Die Registrierung ist kostenlos. Ein Coaching wird anschließend persönlich vereinbart.").font(.footnote).foregroundStyle(.secondary)
    }
    .textFieldStyle(.roundedBorder)
    .padding(sizeClass == .regular ? 36 : 26)
    .frame(maxWidth:sizeClass == .regular ? 560 : .infinity)
    .background {
     if sizeClass == .regular {RoundedRectangle(cornerRadius:28).fill(.white).shadow(color:Brand.navy.opacity(0.08),radius:30,y:12)}
    }
    .frame(maxWidth:.infinity)
    .padding(.vertical,sizeClass == .regular ? 40 : 0)
   }
   .background(sizeClass == .regular ? Brand.pale : .white)
   .navigationTitle("Willkommen")
   .sheet(isPresented:$register){RegistrationView()}
   .sheet(isPresented:$reset){PasswordResetView()}
  }
 }
 func login(){guard !busy else{return};busy=true;error=nil;Task{defer{busy=false};do{let response=try await APIClient.shared.call("/api/auth?action=mobile-login",method:"POST",body:["identifier":identifier,"password":password],authenticated:false);try await store.accept(response);password=""}catch{self.error=error.localizedDescription}}}
}
struct RegistrationView:View {
 @EnvironmentObject var store:AppStore
 @Environment(\.dismiss) var dismiss
 @State private var schema:JSONValue = .null
 @State private var name=""
 @State private var email=""
 @State private var phone=""
 @State private var password=""
 @State private var repeatPassword=""
 @State private var code=""
 @State private var registrationId=""
 @State private var error:String?
 @State private var answers:[String:Int]=[:]
 @State private var accepted=false
 @State private var adult=false
 @State private var busy=false
 var body:some View {NavigationStack {Form {if registrationId.isEmpty {Section("Dein Kontakt"){TextField("Vor- und Nachname",text:$name).textContentType(.name);TextField("E-Mail",text:$email).textContentType(.emailAddress).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled();TextField("Telefon (optional)",text:$phone).keyboardType(.phonePad)};ForEach(schema["intake"].array,id:\.["id"].string){q in Section {Picker(q["question"].string,selection:Binding(get:{answers[q["id"].string] ?? -1},set:{answers[q["id"].string]=$0})){Text(q["optional"].bool ? "Keine Angabe":"Bitte wählen").tag(-1);ForEach(Array(q["options"].array.enumerated()),id:\.offset){index,option in Text(option.string).tag(index)}}.pickerStyle(.inline)}};Section("Deine Entscheidung"){Toggle("Ich bin mindestens 18 Jahre alt.",isOn:$adult);NavigationLink("Datenschutzhinweise lesen"){PrivacyView()};Toggle("Ich habe die Datenschutzhinweise zur Registrierung gelesen.",isOn:$accepted);Text("Deine Antworten helfen Markus, deinen Coachingwunsch einzuschätzen. Die Registrierung verpflichtet dich zu keinem Kauf.").font(.footnote)};PrimaryButton(title:"Bestätigungscode per E-Mail erhalten",busy:busy){start()}.disabled(!adult || !accepted || name.trimmingCharacters(in:.whitespaces).isEmpty || schema.isNull)}else{Section("E-Mail bestätigen"){Text("Den sechsstelligen Code haben wir an \(email) geschickt. Er gilt 15 Minuten.");TextField("Bestätigungscode",text:$code).keyboardType(.numberPad).textContentType(.oneTimeCode);SecureField("Neues Passwort (mindestens 12 Zeichen)",text:$password).textContentType(.newPassword);SecureField("Passwort wiederholen",text:$repeatPassword).textContentType(.newPassword)};PrimaryButton(title:"Konto erstellen",busy:busy){complete()}.disabled(password.count<12 || password != repeatPassword || code.count != 6);Button("Angaben ändern / neuen Code anfordern"){registrationId="";code=""}};InlineError(text:error)}.navigationTitle("Dein Einstieg").toolbar{ToolbarItem(placement:.cancellationAction){Button("Schließen"){dismiss()}.disabled(busy)}}.interactiveDismissDisabled(busy).task{do{schema=try await APIClient.shared.call("/api/auth?action=mobile-schema",authenticated:false)}catch{self.error=error.localizedDescription}}} }
 func start(){busy=true;error=nil;Task{defer{busy=false};do{let cleanAnswers=answers.filter{$0.value>=0};let r=try await APIClient.shared.call("/api/auth?action=mobile-register-start",method:"POST",body:["name":name,"email":email,"phone":phone,"intakeAnswers":cleanAnswers,"privacyAccepted":accepted,"adultConfirmed":adult],authenticated:false);registrationId=r["registrationId"].string}catch{self.error=error.localizedDescription}}}
 func complete(){busy=true;error=nil;Task{defer{busy=false};do{let r=try await APIClient.shared.call("/api/auth?action=mobile-register-complete",method:"POST",body:["registrationId":registrationId,"code":code,"password":password],authenticated:false);try await store.accept(r);password="";repeatPassword="";dismiss()}catch{self.error=error.localizedDescription}}}
}
struct InitialPasswordView:View {
 @EnvironmentObject var store:AppStore
 @State private var password=""
 @State private var confirmation=""
 @State private var error:String?
 @State private var busy=false
 var body:some View {NavigationStack {Form{Section("Dein persönliches Passwort"){Text("Ersetze dein Startpasswort, bevor du auf deine Coachingdaten zugreifst.");SecureField("Neues Passwort",text:$password).textContentType(.newPassword);SecureField("Wiederholen",text:$confirmation).textContentType(.newPassword)};InlineError(text:error);PrimaryButton(title:"Passwort speichern",busy:busy){busy=true;Task{defer{busy=false};do{_ = try await APIClient.shared.call("/api/auth?action=change-initial-password",method:"POST",body:["password":password]);await store.resume()}catch{self.error=error.localizedDescription}}}.disabled(password.count<12 || password != confirmation);Button("Abmelden"){Task{await store.signOut()}}}.navigationTitle("Zugang sichern")}}
}
struct PasswordResetView:View {
 @Environment(\.dismiss) var dismiss
 @State private var email=""
 @State private var code=""
 @State private var password=""
 @State private var confirmation=""
 @State private var requestId=""
 @State private var error:String?
 @State private var busy=false
 @State private var done=false
 var body:some View {NavigationStack {Form{if done {Section{Label("Passwort geändert",systemImage:"checkmark.circle");Text("Du kannst dich jetzt mit deinem neuen Passwort anmelden.");Button("Zur Anmeldung"){dismiss()}}}else{Section{TextField("E-Mail",text:$email).textContentType(.emailAddress).keyboardType(.emailAddress).textInputAutocapitalization(.never).disabled(!requestId.isEmpty);if !requestId.isEmpty {Text("Wenn ein passendes Konto existiert, erhältst du einen sechsstelligen Code per E-Mail.");TextField("Code",text:$code).textContentType(.oneTimeCode).keyboardType(.numberPad);SecureField("Neues Passwort (12 Zeichen)",text:$password);SecureField("Passwort wiederholen",text:$confirmation)}};InlineError(text:error);PrimaryButton(title:requestId.isEmpty ? "Code anfordern":"Passwort ändern",busy:busy){submit()}.disabled(!requestId.isEmpty && (password.count<12 || password != confirmation || code.count != 6))}}.navigationTitle("Passwort zurücksetzen").toolbar{Button("Schließen"){dismiss()}.disabled(busy)}}}
 func submit(){busy=true;error=nil;Task{defer{busy=false};do{if requestId.isEmpty {let r=try await APIClient.shared.call("/api/auth?action=mobile-reset-start",method:"POST",body:["email":email],authenticated:false);requestId=r["registrationId"].string}else{_ = try await APIClient.shared.call("/api/auth?action=mobile-reset-complete",method:"POST",body:["registrationId":requestId,"code":code,"password":password],authenticated:false);done=true;password=""}}catch{self.error=error.localizedDescription}}}
}
