import * as cds from "@sap/cds";

export const checkCameraAvailability = async (req: cds.Request) => {
    // const damagedCameras = await SELECT.from("Installation").columns("ID").where({ status: "Damaged" });
    // // if (damagedCameras.length !== 0) {
    // //     req.error(400, "Some cameras are damaged and not available for use.");
    // // }

    // if(1 === 1{
        
    // })
    // return req;
};

export const areAllCamerasAvailable = async (req: cds.Request) => {
    const damagedCameras = await SELECT.from("Installation").columns("ID").where({ status: "Damaged" });
    // return damagedCameras.length === 0;
    return true;
}

export const getCamerarecordingIdForLocation = async (req: cds.Request) => {
    const { location } = req.data;
    const recording = await SELECT.from("CameraImages")
        .columns("ID")
        .where({ subnauticLocation: location });

    if (recording.length === 1) {
        return recording[0].ID;
    } else {
        req.error(404, `No camera recording found for location ID: ${location}`);
        return req;
    }
}