import Controller from "sap/ui/core/mvc/Controller";
import VizFrame from "sap/viz/ui5/controls/VizFrame";
import Event from "sap/ui/base/Event";
import ResourceModel from "sap/ui/model/resource/ResourceModel";
import Popover from "sap/viz/ui5/controls/Popover";
import ChartFormatter from "sap/viz/ui5/format/ChartFormatter";
import SimpleForm from "sap/ui/layout/form/SimpleForm";
import Label from "sap/m/Label";
import Text from "sap/m/Text";
import Dataset from "sap/viz/ui5/data/Dataset";
import FlattenedDataset from "sap/viz/ui5/data/FlattenedDataset";
/**
 * @namespace flexso.cap.hrf.sonaroverview.controller
 */
export default class SonarOverview extends Controller {
    selectedSonarReading: any;

    public onInit(): void {
        this._initVizFrame();
    }

    private _getDataValue(selected: any, key: string): any {
        const arr = selected?.data?.val;
        if (!Array.isArray(arr)) { return undefined; }
        const entry = arr.find((v: any) => v.id === key || v.name === key);
        return entry?.value;
    }

    private async _initVizFrame(): Promise<void> { 
        //This whole vizframe setup isn't very well documented or known online
        //Don't be afraid to ask some of the Crew to help with this part if you get stuck

        const oViz = this.byId("sonarBubble") as VizFrame;
        //Viz Property logic
        if (oViz) {
            const i18nModel = this.getOwnerComponent()?.getModel("i18n") as ResourceModel | undefined;
            const resourceBundle = await i18nModel?.getResourceBundle();

            oViz.setVizProperties({
                title: { text: resourceBundle?.getText("title") },
                plotArea: {
                    dataLabel: { visible: true },
                    background: { visible: true }
                },
                legend: { visible: true },
                valueAxis: { title: { text: resourceBundle?.getText("HoursInPast") } },
                valueAxis2: { title: { text: resourceBundle?.getText("MilesFromBase") } },
                interaction: { selectability: { mode: "single" } }
            });
            oViz.attachSelectData(this.onSelectData, this);
            oViz.attachEventOnce("renderComplete", () => {
                oViz.setVizProperties({ legend: { title: { text: resourceBundle?.getText("SonarType") } } });
            });
        }

        //You are limited what you can set as context
        //It's definitely a good idea to show the sonar finding
        //Extra challenge: Could there be ways to show more context in the popover?
        (oViz.getDataset() as FlattenedDataset).setContext("SonarFinding");

        //Popover logic
        const vizPopover = this.byId("sonarPopOver") as Popover;
        if (vizPopover) {
            vizPopover.setCustomDataControl( (selectedSonarReading: any) => {
                //HACK THE FUTURE Challenge:
                //We want to visualise our findings when clicked
                
                console.log("Selected sonar reading:", selectedSonarReading);
                this.selectedSonarReading = selectedSonarReading;
                
                    const form = new SimpleForm({
                        editable: false,
                        content: [
                            new Label({ text: "Sonar Finding" }),
                            new Text({ text: this._getDataValue(selectedSonarReading, "SonarFinding") ?? "-" }),
                            new Label({ text: "Hours In Past" }),
                            new Text({ text: String(
                                this._getDataValue(selectedSonarReading, "Hours")
                                ?? this._getDataValue(selectedSonarReading, "HoursInPast")
                                ?? "-"
                            ) }),
                            new Label({ text: "Miles From Base" }),
                            new Text({ text: String(
                                this._getDataValue(selectedSonarReading, "Miles")
                                ?? this._getDataValue(selectedSonarReading, "MilesFromBase")
                                ?? "-"
                            ) })
                        ]
                    });
                    return form;
            })
            vizPopover.connect(oViz.getVizUid());
            vizPopover.setFormatString(ChartFormatter.DefaultPattern.STANDARDFLOAT);
        }

    }

    public onSelectData(oEvent: Event): void {
        const vizFrame = oEvent.getSource() as VizFrame;
        (vizFrame.getDataset() as FlattenedDataset).setContext("SonarFinding");

    }

}