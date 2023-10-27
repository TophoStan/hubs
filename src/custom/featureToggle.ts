
// featureToCheck is the feature you want to check if it is enabled AKA if it was passed down as an environment variable
// featuresAsString is a string of comma separated features that should be enabled
function toggleHubsFeatures(featureToCheck: string, featuresAsString: string): boolean {
    console.log(`featureToCheck: ${featureToCheck}`);
    console.log(`FEATURES_TO_ENABLE: ${featuresAsString}`);
    

    const featureList = featuresAsString.split(',');
    return featureList.indexOf(featureToCheck) !== -1;
}
export default toggleHubsFeatures;