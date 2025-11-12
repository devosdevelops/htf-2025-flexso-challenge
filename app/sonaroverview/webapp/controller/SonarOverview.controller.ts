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

    private _colorFromString(s: string): string {
        let hash = 0;
        for (let i = 0; i < s.length; i++) {
            hash = s.charCodeAt(i) + ((hash << 5) - hash);
            hash = hash & hash;
        }
        const hue = Math.abs(hash) % 360;
        const saturation = 65;
        const lightness = 50;
        return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    }

    private async _initVizFrame(): Promise<void> { 
        //This whole vizframe setup isn't very well documented or known online
        //Don't be afraid to ask some of the Crew to help with this part if you get stuck

        const oViz = this.byId("sonarBubble") as VizFrame;
        //Viz Property logic
        if (oViz) {
            const i18nModel = this.getOwnerComponent()?.getModel("i18n") as ResourceModel | undefined;
            const resourceBundle = await i18nModel?.getResourceBundle();

            const baseProps: any = {
                title: { text: resourceBundle?.getText("title") },
                plotArea: {
                    dataLabel: { visible: true },
                    background: { visible: true }
                },
                legend: { visible: true },
                valueAxis: { title: { text: resourceBundle?.getText("HoursInPast") } },
                valueAxis2: { title: { text: resourceBundle?.getText("MilesFromBase") } },
                interaction: { selectability: { mode: "single" } }
            };

            const strengthGradient = ['#2ca02c', '#98df8a', '#ffcc00', '#ff7f0e', '#d62728'];
            baseProps.plotArea.colorPalette = strengthGradient;
            oViz.setVizProperties(baseProps);
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
                    // Read sonar type fields exposed via dataset dimensions (fallbacks supported)
                    const form = new SimpleForm({
                        editable: false,
                        content: [
                            // new Label({ text: "Sonar Type" }),
                            // new Text({ text: "-" }),
                            // new Label({ text: "Sonar Type ID" }),
                            // new Text({ text: this._getDataValue(selectedSonarReading, "sonarTypeId") ?? "-" }),

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
                            ) }),

                            new Label ({ text: 'Size'}),
                            new Text ({ text: String(
                                this._getDataValue(selectedSonarReading, "Size")
                                ?? "-"
                            )})
                        ]
                    });
                    return form;
            })
            vizPopover.connect(oViz.getVizUid());
            vizPopover.setFormatString(ChartFormatter.DefaultPattern.STANDARDFLOAT);
        }
        
        try {
            const resp = await fetch('/odata/v4/admin/Sonar?$expand=sonarType,subnauticLocation&$select=ID,finding,hoursInPast,milesFromBase,signalStrength,sonarType_ID');
            if (resp.ok) {
                const json = await resp.json();
                const rows = (json && json.value) || [];
                const enriched = rows.map((r: any) => {
                    const hours = Number(r.hoursInPast || 0);
                    let bucket = 'recent';
                    if (hours > 24) bucket = 'old';
                    else if (hours > 6) bucket = 'stale';
                    return Object.assign({}, r, { AgeBucket: bucket, Hours: hours, Miles: r.milesFromBase, Size: r.signalStrength });
                });
                const JSONModel = (await import('sap/ui/model/json/JSONModel')).default;
                const m = new JSONModel({ Sonar: enriched });
                this.getView()?.setModel(m, 'sonarLocal');
                const counts = enriched.reduce((acc: any, r: any) => { acc[r.AgeBucket] = (acc[r.AgeBucket] || 0) + 1; return acc; }, {});
                console.debug('[sonaroverview] AgeBucket counts', counts);
                try {
                    const viz = this.byId('sonarBubble') as any;
                    const ds = this.byId('sonarDataset') as any;
                    if (ds && typeof ds.setData === 'function') {
                        ds.setData(enriched);
                    }
                    if (viz && typeof viz.invalidate === 'function') viz.invalidate();
                } catch (e) {
                    /* best-effort refresh */
                }
            } else {
                console.warn('[sonaroverview] sonar fetch failed', resp.status);
            }
        } catch (e) {
            console.warn('[sonaroverview] failed to load sonar data for buckets', e);
        }

    }

    public onSelectData(oEvent: Event): void {
        const vizFrame = oEvent.getSource() as VizFrame;
        (vizFrame.getDataset() as FlattenedDataset).setContext("SonarFinding");

    }

}