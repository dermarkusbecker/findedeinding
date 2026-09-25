"""Reproducible native Xcode project, no external project generator required."""
from pathlib import Path
import hashlib,json
root=Path(__file__).resolve().parent
objects={}
def ident(label):return hashlib.sha1(label.encode()).hexdigest()[:24].upper()
def add(label,body):key=ident(label);objects[key]=body;return key
def q(s):return json.dumps(str(s))
def array(items):return '('+','.join(items)+',)' if items else '()'
source_refs=[];source_build=[];resources=[];resource_build=[]
for path in sorted((root/'FindeDeinDing/Sources').glob('*.swift')):
 rel=path.relative_to(root);ref=add(str(rel),'{isa=PBXFileReference;lastKnownFileType=sourcecode.swift;path='+q(rel)+';sourceTree="<group>";}');source_refs.append(ref);source_build.append(add('build'+str(rel),'{isa=PBXBuildFile;fileRef='+ref+';}'))
for path in [root/'FindeDeinDing/Assets.xcassets',*sorted((root/'FindeDeinDing/Resources').glob('*'))]:
 rel=path.relative_to(root);kind='folder.assetcatalog' if path.suffix=='.xcassets' else 'text.xml' if path.suffix=='.xcprivacy' else 'text';ref=add(str(rel),'{isa=PBXFileReference;lastKnownFileType='+kind+';path='+q(rel)+';sourceTree="<group>";}');resources.append(ref);resource_build.append(add('build'+str(rel),'{isa=PBXBuildFile;fileRef='+ref+';}'))
product=add('product','{isa=PBXFileReference;explicitFileType=wrapper.application;includeInIndex=0;path=FindeDeinDing.app;sourceTree=BUILT_PRODUCTS_DIR;}')
product_group=add('products','{isa=PBXGroup;children=('+product+',);name=Products;sourceTree="<group>";}')
group=add('mainGroup','{isa=PBXGroup;children='+array(source_refs+resources+[product_group])+';sourceTree="<group>";}')
sources=add('sources','{isa=PBXSourcesBuildPhase;buildActionMask=2147483647;files='+array(source_build)+';runOnlyForDeploymentPostprocessing=0;}')
resources_phase=add('resources','{isa=PBXResourcesBuildPhase;buildActionMask=2147483647;files='+array(resource_build)+';runOnlyForDeploymentPostprocessing=0;}')
package=add('corePackage','{isa=XCLocalSwiftPackageReference;relativePath=CoachingCore;}')
core=add('coreProduct','{isa=XCSwiftPackageProductDependency;package='+package+';productName=CoachingCore;}')
corebuild=add('coreBuild','{isa=PBXBuildFile;productRef='+core+';}')
frameworks=add('frameworks','{isa=PBXFrameworksBuildPhase;buildActionMask=2147483647;files=('+corebuild+',);runOnlyForDeploymentPostprocessing=0;}')
def configurations(label,settings):
 result=[]
 for mode in ['Debug','Release']:
  values={**settings,'SWIFT_OPTIMIZATION_LEVEL':'-Onone' if mode=='Debug' else '-O','DEBUG_INFORMATION_FORMAT':'dwarf' if mode=='Debug' else 'dwarf-with-dsym'}
  if mode=='Debug':values['SWIFT_ACTIVE_COMPILATION_CONDITIONS']='DEBUG'
  result.append(add(label+mode,'{isa=XCBuildConfiguration;name='+mode+';buildSettings={'+''.join(key+'='+q(value)+';' for key,value in values.items())+'};}'))
 return add(label+'configs','{isa=XCConfigurationList;buildConfigurations='+array(result)+';defaultConfigurationIsVisible=0;defaultConfigurationName=Release;}')
project_configs=configurations('project',{'CLANG_ENABLE_MODULES':'YES','CLANG_ENABLE_OBJC_ARC':'YES','SDKROOT':'iphoneos','IPHONEOS_DEPLOYMENT_TARGET':'17.0','SWIFT_VERSION':'5.0','ENABLE_USER_SCRIPT_SANDBOXING':'YES'})
target_configs=configurations('target',{'PRODUCT_BUNDLE_IDENTIFIER':'de.findedeinding.coaching','PRODUCT_NAME':'$(TARGET_NAME)','INFOPLIST_FILE':'FindeDeinDing/Info.plist','CODE_SIGN_STYLE':'Automatic','DEVELOPMENT_TEAM':'LCYUVY9ZZ4','TARGETED_DEVICE_FAMILY':'1,2','ASSETCATALOG_COMPILER_APPICON_NAME':'AppIcon','GENERATE_INFOPLIST_FILE':'NO','SWIFT_EMIT_LOC_STRINGS':'YES','SUPPORTED_PLATFORMS':'iphoneos iphonesimulator','SUPPORTS_MACCATALYST':'NO','SUPPORTS_XR_DESIGNED_FOR_IPHONE_IPAD':'NO','ENABLE_PREVIEWS':'YES','LD_RUNPATH_SEARCH_PATHS':'$(inherited) @executable_path/Frameworks'})
target=add('target','{isa=PBXNativeTarget;name=FindeDeinDing;productName=FindeDeinDing;productReference='+product+';productType="com.apple.product-type.application";buildConfigurationList='+target_configs+';buildPhases='+array([sources,frameworks,resources_phase])+';buildRules=();dependencies=();packageProductDependencies=('+core+',);} ')
project=add('project','{isa=PBXProject;attributes={BuildIndependentTargetsInParallel=YES;LastUpgradeCheck=1600;};buildConfigurationList='+project_configs+';compatibilityVersion="Xcode 14.0";developmentRegion=de;hasScannedForEncodings=0;knownRegions=(de,en,Base);mainGroup='+group+';productRefGroup='+product_group+';projectDirPath="";projectRoot="";targets=('+target+',);packageReferences=('+package+',);}')
(root/'FindeDeinDing.xcodeproj/project.pbxproj').write_text('// !$*UTF8*$!\n{archiveVersion=1;classes={};objectVersion=56;objects={\n'+'\n'.join(key+' = '+body+';' for key,body in objects.items())+'\n};rootObject='+project+';}\n')
(root/'FindeDeinDing.xcodeproj/xcshareddata/xcschemes/FindeDeinDing.xcscheme').write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.3">
 <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{target}" BuildableName="FindeDeinDing.app" BlueprintName="FindeDeinDing" ReferencedContainer="container:FindeDeinDing.xcodeproj"/></BuildActionEntry></BuildActionEntries></BuildAction>
 <TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"/>
 <LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{target}" BuildableName="FindeDeinDing.app" BlueprintName="FindeDeinDing" ReferencedContainer="container:FindeDeinDing.xcodeproj"/></BuildableProductRunnable></LaunchAction>
 <ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"/>
 <AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>''')
print('Native Xcode project generated.')
