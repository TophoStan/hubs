
// featureToCheck is the feature you want to check if it is enabled AKA if it was passed down as an environment variable
// featuresAsString is a string of comma separated features that should be enabled
function toggleHubsFeatures(featureToCheck: string, featuresAsString: string): boolean {

    // featuresAsString = "voice_chat,cool"



    try {
        console.log(`featuresAsString: ${featuresAsString}`);

        const featureList = featuresAsString.replace(" ", "").split(',');
        const isFeatureEnabled = featureList.indexOf(featureToCheck) !== -1;
        console.log(`${featureToCheck}: ${isFeatureEnabled}`);


        return isFeatureEnabled;
    } catch (error) {
        console.log(error);

        return true;
    }

}
export default toggleHubsFeatures;

export function isToolbarEmpty(featuresAsString: string) {
    const hubsToolbarFeatures: string[] = [
        "text_chat",
        "voice_chat",
        "share",
        "flying",
        "teleport",
        "place",
        "place_pen",
        "place_camera",
        "place_gif",
        "place_3dmodel",
        "place_avatar",
        "place_scene",
        "place_upload",
        "react",
        "avatar_setup",
        "invite",
    ];
    try {

        const featureList = featuresAsString.split(',');
        let isToolbarEmpty = true;
        // hubsToolbarFeatures.forEach((feature) => {

        //     isToolbarEmpty = featureList.indexOf(feature) !== -1 ? true : false;

        // })
        for (let i = 0; i < hubsToolbarFeatures.length; i++) {
            if (featureList.indexOf(hubsToolbarFeatures[i]) !== -1) {
                isToolbarEmpty = false;
                break;
            }
        }

        return isToolbarEmpty;
    } catch (error) {

    }


}
