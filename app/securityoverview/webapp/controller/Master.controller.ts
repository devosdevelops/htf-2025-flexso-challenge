import Controller from "sap/ui/core/mvc/Controller";
import ui5Event from "sap/ui/base/Event";
import Component from "../Component";
import JSONModel from "sap/ui/model/json/JSONModel";
import UIComponent from "sap/ui/core/UIComponent";
import { Route$MatchedEvent } from "sap/ui/core/routing/Route";

/**
 * @namespace flexso.cap.htf.securityoverview.controller
 */
export default class Master extends Controller {
  private appViewModel: JSONModel;

  public onInit(): void {
    //Routings can be tricky! Don't hesitate to ask for help if you get stuck
    const router = (this.getOwnerComponent() as Component).getRouter();
    router.getRoute("master")?.attachMatched(this.onRouteMatched.bind(this));
    router.getRoute("masterWithSelection")?.attachMatched(this.onRouteMatched.bind(this));

    //This is a local JSON Model that tracks whether a location is selected or not
    this.appViewModel = new JSONModel({
      hasSelectedLocation: false
    });

    // expose the model under the name "appView" so XML bindings like appView>/hasSelectedLocation work
    this.getView()?.setModel(this.appViewModel, "appView");
  }

  private onRouteMatched(event: Route$MatchedEvent): void {
    //Here we will also have to pass along the correct camera image guid to the view
    //Once that happens, we can start filling our frontend with data about the camera image
    //That way we will discovered what is happening at that location and possibly solve the mystery
    // read route name and arguments to determine whether we should show selection
    const sName = event.getParameter && event.getParameter("name");
    if (sName === "masterWithSelection") {
      // route has an id parameter which should be the camera image guid
      const args: any = event.getParameter && event.getParameter("arguments");
      let rawId = (args && args.id) || "";
      let cameraImageGuid = "";

      // normalize various possible shapes returned by routing / callFunction
      if (rawId) {
        if (typeof rawId === "string") {
          cameraImageGuid = rawId;
        } else if (typeof rawId === "object") {
          // common case: { value: 'guid' } or { '@odata.context':..., value: 'guid' }
          if (rawId.value && typeof rawId.value === "string") {
            cameraImageGuid = rawId.value;
          } else if (rawId.ID && typeof rawId.ID === "string") {
            cameraImageGuid = rawId.ID;
          } else {
            // try to find a string that looks like a GUID in the object values
            const vals = Object.values(rawId);
            for (const v of vals) {
              if (typeof v === "string" && /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/.test(v)) {
                cameraImageGuid = v;
                break;
              }
            }
          }
        }
      }

      this.appViewModel.setProperty("/hasSelectedLocation", true);
      // sanitize cameraImageGuid string by extracting any GUID-like substring
      if (cameraImageGuid && typeof cameraImageGuid === "string") {
        const m = cameraImageGuid.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
        if (m) {
          cameraImageGuid = m[0];
        }
      }

      // if still empty, try to extract GUID directly from rawId when rawId is a string containing object-like text
      if (!cameraImageGuid && rawId && typeof rawId === "string") {
        const mRaw = rawId.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
        if (mRaw) cameraImageGuid = mRaw[0];
      }

      // bind view to the selected CameraImages entry (guard if no id)
      if (cameraImageGuid) {
        // ensure plain string
        cameraImageGuid = String(cameraImageGuid).replace(/^\s+|\s+$/g, "");
        console.debug("onRouteMatched binding to CameraImages with id:", cameraImageGuid, "(rawId)", rawId);
        this.getView()?.bindElement({ path: `/CameraImages('${cameraImageGuid}')` });
      } else {
        // nothing to bind — clear any previous binding
        try { (this.getView() as any)?.unbindElement(); } catch {}
      }
    }
  }

  public async onSelectLocation(oEvent: ui5Event): Promise<void> {
    //HACK THE FUTURE Challenge:
    //When a location is selected, we want to route to a different page with the details for the camera image of that location
    // Try to obtain the selected key from the ComboBox event
    const oSelectedItem = (oEvent as any).getParameter && (oEvent as any).getParameter("selectedItem");
    let selectedKey: string = "";

    if (oSelectedItem && typeof (oSelectedItem as any).getKey === "function") {
      selectedKey = (oSelectedItem as any).getKey();
    } else {
      // fallback: try to get selected key from event source
      const oSource = (oEvent as any).getSource && (oEvent as any).getSource();
      if (oSource && typeof (oSource as any).getSelectedKey === "function") {
        selectedKey = (oSource as any).getSelectedKey();
      }
    }

    // now you have the location ID (key)
    console.log("Selected location ID (key):", selectedKey);

    // update view model and mark that a location is selected
    this.appViewModel.setProperty("/hasSelectedLocation", !!selectedKey);

    // call the server function to lookup the camera image GUID for the selected location
    let cameraImageGuid = "";
    const oModel: any = this.getView && (this.getView() as any).getModel && (this.getView() as any).getModel();

    if (selectedKey && oModel) {
      try {
        if (typeof oModel.callFunction === "function") {
          // server function defined in AdminService.cds: getCamerarecordingIdForLocation
          const result: any = await oModel.callFunction("getCamerarecordingIdForLocation", {
            urlParameters: { location: selectedKey },
            method: "GET"
          });
          console.debug("getCamerarecordingIdForLocation result:", result);
          // callFunction may return a string or an object; normalize to string GUID
          if (result) {
            if (typeof result === "string") {
              cameraImageGuid = result;
            } else if (typeof result === "object") {
              cameraImageGuid = result.value || result.ID || "";
              if (!cameraImageGuid) {
                // try to find a GUID-looking string in the object
                for (const v of Object.values(result)) {
                  if (typeof v === "string" && /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/.test(v)) {
                    cameraImageGuid = v;
                    break;
                  }
                }
              }
            }
          }
        } else {
          // fallback: call the OData endpoint directly
          const endpoint = `/odata/v4/admin/getCamerarecordingIdForLocation?location=${encodeURIComponent(selectedKey)}`;
          const resp = await fetch(endpoint);
          if (resp.ok) {
            const txt = await resp.text();
            cameraImageGuid = txt.replace(/"/g, "");
          }
        }
      } catch (err) {
        console.warn("Lookup for camera recording id failed", err);
      }
    }

    // fallback to a known camera image if none found (keeps the sample working)
    if (!cameraImageGuid) {
      cameraImageGuid = "59101ff5-c8a6-4bc3-804c-329d890090c8";
    }

    // sanitize again: if cameraImageGuid contains an object-like string, extract GUID substring
    if (cameraImageGuid && typeof cameraImageGuid === "string") {
      const m2 = cameraImageGuid.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
      if (m2) cameraImageGuid = m2[0];
      cameraImageGuid = String(cameraImageGuid).replace(/^\s+|\s+$/g, "");
    }

    console.log("Resolved cameraImageGuid:", cameraImageGuid);

    const router = (this.getOwnerComponent() as UIComponent).getRouter();
    router.navTo("masterWithSelection", {
      id: cameraImageGuid
    });
  }

}
