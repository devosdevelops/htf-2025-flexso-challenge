import Controller from "sap/ui/core/mvc/Controller";
import Component from "../Component";
import formatter from "../model/formatter";
import ODataContextBinding from "sap/ui/model/odata/v4/ODataContextBinding";
import Context from "sap/ui/model/odata/v4/Context";
import ListItemBase from "sap/m/ListItemBase";
import Table from "sap/m/Table";
import JSONModel from "sap/ui/model/json/JSONModel";
import Fragment from "sap/ui/core/Fragment";
import Dialog from "sap/m/Dialog";
import BusyIndicator from "sap/ui/core/BusyIndicator";
import ProcessFlow from "sap/suite/ui/commons/ProcessFlow";
import ListItem from "sap/ui/core/ListItem";
import ColumnListItem from "sap/m/ColumnListItem";
import Text from "sap/m/Text";
import ui5Event from "sap/ui/base/Event";
/**
 * @namespace flexso.cap.htf.baserepair.controller
 */
export default class Master extends Controller {
  formatter = formatter;
  table: Table;
  orderDialog: Dialog;

  public onInit(): void {
    const router = (this.getOwnerComponent() as Component).getRouter();
    router.attachRouteMatched(this.onRouteMatched, this);
  }

  private bindProductCamera(productId: string) {
    const path = `/ProductCamera('${productId}')`;
    this.getView()?.bindObject({ path, parameters: { $expand: 'materials,installations' } });
  }

  public onRouteMatched(): void {
    this.bindProductCamera('0a85863f-100d-4e0b-91a1-89897f4490d6');
    this.table = this.byId('idMaterialTable') as Table;
    try {
      const itemsBinding = this.table.getBinding('items');
      console.debug('[debug] itemsBinding:', !!itemsBinding, itemsBinding && itemsBinding.getPath && itemsBinding.getPath());
      if (itemsBinding && typeof (itemsBinding as any).refresh === 'function') (itemsBinding as any).refresh();
      setTimeout(() => {
        try {
          const items = this.table.getItems() || [];
          console.debug('[debug] table items count:', items.length);
          if (items.length === 0) {
            const template = new ColumnListItem({
              cells: [
                new Text({ text: '{name}' }),
                new Text({ text: '{amountInStock}' }),
                new Text({ text: '{amountOrderd}' }),
                new Text({ text: '{amountNeededForProduction}' })
              ]
            });
            this.table.bindItems({ path: 'materials', template });
          }
        } catch (e) {
          console.warn('[debug] reading table items failed', e);
        }
      }, 300);
    } catch (e) {
      /* no-op */
    }
  }

  public async order(): Promise<void> {
    const orderModel = new JSONModel({ amount: 0, selected: [] });
    if (!this.orderDialog) {
      this.orderDialog = (await Fragment.load({ name: 'flexso.cap.htf.baserepair.view.fragments.order', controller: this })) as Dialog;
      this.getView()?.addDependent(this.orderDialog);
    }
    const selectedItems = this.table.getSelectedItems() || [];
    const selectedData = selectedItems.map(si => si.getBindingContext && si.getBindingContext() ? si.getBindingContext()!.getObject() : null).filter(x => !!x).map((o: any) => ({ ID: o.ID, name: o.name, amountInStock: o.amountInStock }));
    orderModel.setProperty('/selected', selectedData);
    this.orderDialog.setModel(orderModel, 'order');
    this.orderDialog.open();
  }

  private async callBoundAction(functionName: string, context: Context | null, urlParams?: Record<string, any>): Promise<void> {
    const model = this.getView()?.getModel() as any;
    if (model && typeof model.callFunction === 'function') {
      await model.callFunction(functionName, { context, urlParameters: urlParams, method: 'POST' });
      return;
    }
    const ctxPath = context && typeof context.getPath === 'function' ? context.getPath() : '';
    const endpoint = `/odata/v4/admin${ctxPath}/${functionName}`;
    const resp = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: urlParams ? JSON.stringify(urlParams) : undefined });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${endpoint}`);
  }

  public async saveOrder(): Promise<void> {
    this.orderDialog.close();
    BusyIndicator.show();
    try {
      const amount = parseInt(this.orderDialog.getModel('order')?.getProperty('/amount') as string) || 0;
      if (amount <= 0) return;
      const selectedItems = this.table.getSelectedItems() || [];
      if (selectedItems.length === 0) return;
      const promises = selectedItems.map(async (item: ListItemBase) => {
        const itemCtx = item.getBindingContext() as Context;
        const params = { amount, id: itemCtx.getProperty('ID') };
        console.debug('[debug] ordering', params);
        await this.callBoundAction('order', itemCtx, params);
        try { if (itemCtx && typeof (itemCtx as any).refresh === 'function') await (itemCtx as any).refresh(); } catch {}
        try {
          const cur = itemCtx.getProperty && itemCtx.getProperty('amountOrderd');
          const inc = params.amount || 0;
          if (typeof cur === 'number') {
            const modelForCtx = itemCtx.getModel && itemCtx.getModel();
            if (modelForCtx) {
              try { (modelForCtx as any).setProperty(itemCtx.getPath() + '/amountOrderd', cur + inc); } catch {}
            }
          }
        } catch {}
      });
      await Promise.all(promises);
      try {
        const view = this.getView();
        const viewCtx = view && (view as any).getBindingContext && (view as any).getBindingContext();
        if (viewCtx && typeof (viewCtx as any).refresh === 'function') {
          await (viewCtx as any).refresh();
        } else if (view && typeof view.bindObject === 'function' && viewCtx && viewCtx.getPath) {
          view.bindObject({ path: viewCtx.getPath(), parameters: { $expand: 'materials,installations' } });
        } else {
          const itemsBinding = this.table.getBinding('items');
          if (itemsBinding && typeof (itemsBinding as any).refresh === 'function') (itemsBinding as any).refresh();
          else this.table.getModel()?.refresh();
        }
      } catch (e) {
        console.warn('[debug] refresh failed', e);
        this.table.getModel()?.refresh();
      }
    } catch (e) {
      console.warn('[debug] order failed', e);
    } finally {
      BusyIndicator.hide();
    }
  }

  public closeDialog(): void {
    this.orderDialog.close();
  }

  public refresh(): void {
    try { const b = this.table.getBinding('items'); console.debug('[debug] refresh binding path', b && b.getPath && b.getPath()); } catch {}
    this.table.getModel()?.refresh();
  }

  public async produce(): Promise<void> {
    BusyIndicator.show();
    try {
      const view = this.getView();
      const bindingContext = view && (view as any).getBindingContext && (view as any).getBindingContext();
      if (!bindingContext) return;
      await this.callBoundAction('produce', bindingContext);
      try { this.refeshProducton(); } catch {}
      view.getModel()?.refresh();
    } catch (e) {
      console.error('[debug] produce failed', e);
    } finally {
      BusyIndicator.hide();
    }
  }

  public refeshProducton(): void {
    const processFlow = this.byId('processflow') as ProcessFlow;
    processFlow.updateModel();
  }

  public async replaceCamera(event: ui5Event): Promise<void> {
    const src = (event.getSource && event.getSource()) as any;
    let bindingContext = src && src.getBindingContext ? src.getBindingContext() : null;
    if (!bindingContext) {
      const parent = src && src.getParent ? src.getParent() : null;
      bindingContext = parent && parent.getBindingContext ? parent.getBindingContext() : null;
    }
    if (!bindingContext) {
      const listItem = event.getParameter('listItem' as never) as ListItem | undefined;
      bindingContext = listItem ? listItem.getBindingContext() : null;
    }
    if (!bindingContext) return;
    const id = bindingContext.getProperty('ID');
    try {
      await this.callBoundAction('replace', bindingContext, { id });
    } catch (e) {
      console.error('[debug] replace failed', e);
    }
    (this.byId('idInstallationsTable') as Table).getModel()?.refresh();
  }
}
