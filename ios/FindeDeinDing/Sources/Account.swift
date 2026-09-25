import SwiftUI
import CoachingCore
import PhotosUI
struct AccountView:View {
 @EnvironmentObject var store:AppStore
 @State private var photo:PhotosPickerItem?
 @State private var uploading=false
 @State private var error:String?
 var body:some View {List {Section {HStack(spacing:16){AsyncImage(url:URL(string:store.overview["profile"]["photoUrl"].string)){image in image.resizable().scaledToFill()}placeholder:{Image(systemName:"person.crop.circle.fill").resizable().foregroundStyle(Brand.navy)}.frame(width:64,height:64).clipShape(Circle());VStack(alignment:.leading){Text(store.user["name"].string).font(.title3.bold());Text(store.user["email"].string).font(.callout)}};PhotosPicker(selection:$photo,matching:.images){Label(uploading ? "Bild wird gespeichert …":"Profilbild ändern",systemImage:"camera")}.disabled(uploading);InlineError(text:error)};Section("Deine Daten"){NavigationLink("Kontaktdaten"){ContactView()};if store.coaching{NavigationLink("Erkenntnisse & Klarheitsverlauf"){InsightsView()};NavigationLink("Frage an Markus"){SupportView(week:max(1,store.program["access"]["processWeek"].int))}}};Section("Datenschutz & Informationen"){NavigationLink("Datenschutz"){PrivacyView()};NavigationLink("Impressum"){LegalTextView(resource:"Imprint",title:"Impressum")};NavigationLink("Konto endgültig löschen"){DeleteAccountView()}.foregroundStyle(.red)};Section{Button("Abmelden",role:.destructive){Task{await store.signOut()}};Text("Finde dein Ding · Version 1.0\nNative iPhone- und iPad-App · Keine Werbetracker").font(.caption).foregroundStyle(.secondary)}}.navigationTitle("Dein Profil").onChange(of:photo){_,item in guard let item=item else{return};Task{uploading=true;defer{uploading=false};do{guard let data=try await item.loadTransferable(type:Data.self),let image=UIImage(data:data),let jpeg=image.jpegData(compressionQuality:0.8),jpeg.count<=3*1024*1024 else{throw APIError(message:"Bitte ein Bild mit maximal 3 MB auswählen.",status:0)};_ = try await APIClient.shared.call("/api/customer-records?action=avatar-upload",method:"POST",body:["fileName":"Profilbild.jpg","mimeType":"image/jpeg","contentBase64":jpeg.base64EncodedString()]);await store.reload()}catch{self.error=error.localizedDescription}}}}
}
struct ContactView:View {
 @EnvironmentObject var store:AppStore
 @State private var name=""
 @State private var phone=""
 @State private var street=""
 @State private var postalCode=""
 @State private var city=""
 @State private var country=""
 @State private var busy=false
 @State private var message:String?
 var body:some View{Form{Section("Persönliche Angaben"){TextField("Name",text:$name).textContentType(.name);Text(store.user["email"].string).foregroundStyle(.secondary);TextField("Mobilnummer",text:$phone).keyboardType(.phonePad);TextField("Straße und Hausnummer",text:$street);TextField("Postleitzahl",text:$postalCode);TextField("Ort",text:$city);TextField("Land",text:$country)};Text("Die E-Mail-Adresse ist deine Anmeldeadresse. Bei einer Änderung unterstützt dich Markus.").font(.footnote);if let message=message{Text(message)};PrimaryButton(title:"Änderungen speichern",busy:busy){busy=true;Task{defer{busy=false};do{_ = try await APIClient.shared.call("/api/auth?action=mobile-profile",method:"PATCH",body:["name":name,"mobile_phone":phone,"street":street,"postal_code":postalCode,"city":city,"country":country]);await store.resume();message="Deine Kontaktdaten wurden gespeichert."}catch{message=error.localizedDescription}}}}.navigationTitle("Kontaktdaten").task{let p=store.overview["profile"];name=store.user["name"].string;phone=p["mobile_phone"].string;street=p["street"].string;postalCode=p["postal_code"].string;city=p["city"].string;country=p["country"].string}}
}
struct DeleteAccountView:View {
 @EnvironmentObject var store:AppStore
 @State private var password=""
 @State private var confirmed=false
 @State private var busy=false
 @State private var error:String?
 @State private var requestId=UUID().uuidString
 @State private var receipt=""
 @State private var pending=false
 @State private var complete=false
 var body:some View {Form{Section{Label("Dein Konto endgültig löschen",systemImage:"person.crop.circle.badge.xmark").font(.title2.bold());Text("Dein App-Zugang, Coachingverlauf, Reflexionen und persönliche Coachingdateien werden gelöscht. Das lässt sich nicht rückgängig machen.");Text("Gesetzlich aufzubewahrende Rechnungs- und Vertragsbelege bleiben geschützt erhalten. Die Kontolöschung beendet einen bestehenden Vertrag oder offene Forderungen nicht automatisch.");Text("Lade Unterlagen, die du behalten möchtest, vorher unter „Unterlagen“ herunter.")};if pending {Section{Text("Dein Zugang ist gesperrt. Die Dateibereinigung wird abgeschlossen.");Button("Löschstatus prüfen"){check()}.disabled(busy)}}else if complete {Label("Dein Konto wurde gelöscht",systemImage:"checkmark.circle")}else{Section{SecureField("Mit deinem Passwort bestätigen",text:$password).textContentType(.password);Toggle("Ich möchte mein Konto und meine Coachingdaten unwiderruflich löschen.",isOn:$confirmed);Button(role:.destructive){remove()}label:{HStack{if busy{ProgressView()};Text("Konto endgültig löschen")}}.disabled(!confirmed || password.isEmpty || busy)}};InlineError(text:error)}.navigationTitle("Konto löschen").interactiveDismissDisabled(busy)}
 func remove(){busy=true;error=nil;Task{defer{busy=false};do{let result=try await APIClient.shared.call("/api/auth?action=mobile-delete",method:"POST",body:["password":password,"confirmed":confirmed,"requestId":requestId]);receipt=result["receipt"].string;let proof=try JSONEncoder().encode(result);await APIClient.shared.clear();try Keychain.save(proof,key:"deletion-receipt");pending = !result["complete"].bool;complete = !pending;password="";if complete{await store.signOut()}else{store.error="Die Löschung ist beauftragt. Dein Zugang wurde gesperrt. Die technische Bereinigung wird fortgesetzt.";await store.signOut();try Keychain.save(proof,key:"deletion-receipt")}}catch{self.error=error.localizedDescription}}}
 func check(){busy=true;Task{defer{busy=false};do{let r=try await APIClient.shared.call("/api/auth?action=mobile-delete-status",method:"POST",body:["requestId":requestId,"receipt":receipt],authenticated:false);if r["complete"].bool{complete=true;pending=false;await store.signOut()}}catch{self.error=error.localizedDescription}}}
}
struct PrivacyView:View {var body:some View{LegalTextView(resource:"AppPrivacy",title:"Datenschutz")}}
struct LegalTextView:View {let resource:String,title:String;var body:some View{ScrollView{Text(text).textSelection(.enabled).frame(maxWidth:.infinity,alignment:.leading).padding(24)}.navigationTitle(title).navigationBarTitleDisplayMode(.inline)};var text:String{guard let url=Bundle.main.url(forResource:resource,withExtension:"txt"),let text=try? String(contentsOf:url,encoding:.utf8)else{return "Die Information konnte nicht geladen werden. Bitte wende dich an markus@dermarkusbecker.de."};return text}}
