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
    (this.getOwnerComponent() as Component)
      .getRouter()
      .attachRouteMatched(this.onRouteMatched, this);
  }

  onRouteMatched() {
    this.getView()?.bindObject({
      path: "/ProductCamera('0a85863f-100d-4e0b-91a1-89897f4490d6')",
      parameters: {
        $expand: "materials,installations",
      },
    });

    this.table = this.byId("idMaterialTable") as Table;
    // try to refresh items binding so expanded materials are requested and displayed
    try {
      const b = this.table.getBinding("items");
      console.log('[debug] materials items binding:', !!b, b && b.getPath && b.getPath());
      if (b && typeof b.refresh === 'function') b.refresh();
      // After a short delay, log how many items are present in the table
      setTimeout(() => {
        try {
          const items = this.table.getItems();
          console.log('[debug] table items count:', items ? items.length : 0);
          if (items && items.length > 0) {
            const firstContext = items[0].getBindingContext();
            console.log('[debug] first item context:', firstContext ? firstContext.getObject() : null);
          } else {
            // fallback: programmatically bind items to relative './materials' using a simple template
              try {
              console.warn('[debug] no items found in table; applying programmatic fallback binding to materials');
              const template = new ColumnListItem({
                cells: [
                  new Text({ text: '{name}' }),
                  new Text({ text: '{amountInStock}' }),
                  new Text({ text: '{amountOrderd}' }),
                  new Text({ text: '{amountNeededForProduction}' })
                ]
              });
              // bind to 'materials' (relative path without './') to avoid './' appearing in OData path
              this.table.bindItems({ path: 'materials', template });
            } catch (fbErr) {
              console.error('[debug] fallback bind error', fbErr);
            }
          }
        } catch (e) {
          console.warn('[debug] error reading table items', e);
        }
      }, 300);
    } catch (e) {
      /* non-fatal */
    }
  }

  async order() {
    const orderModel = new JSONModel({
      amount: 0,
      selected: []
    });

    if (!this.orderDialog) {
      this.orderDialog ??= (await Fragment.load({
        name: "flexso.cap.htf.baserepair.view.fragments.order",
        controller: this,
      })) as Dialog;

      this.getView()?.addDependent(this.orderDialog);
    }

    // populate selected materials (if any) so the dialog can show them and their stock
    const selectedItems = this.table.getSelectedItems();
    const selectedData = selectedItems
      .map(si => {
        const ctx = si.getBindingContext && si.getBindingContext();
        return ctx ? ctx.getObject() : null;
      })
      .filter((x): x is any => !!x)
      .map((o: any) => ({
        ID: o.ID,
        name: o.name,
        amountInStock: o.amountInStock
      }));
    orderModel.setProperty('/selected', selectedData);
    this.orderDialog.setModel(orderModel, "order");

    this.orderDialog.open();
  }

  async saveOrder() {
    this.orderDialog.close();
    BusyIndicator.show();
    const amount = parseInt(
      this.orderDialog.getModel("order")?.getProperty("/amount") as string
    );

    if (amount === 0 || amount === undefined) {
      BusyIndicator.hide();
      return;
    }

    const selectedItems = this.table.getSelectedItems();
    if (!selectedItems || selectedItems.length === 0) {
      BusyIndicator.hide();
      return;
    }

    const model = this.getView()?.getModel();
    const odataModel: any = model;
    const functionName = 'order';

    // build promises for all selected items and await them together so we refresh once
    const promises = selectedItems.map(async (item: ListItemBase) => {
      const itemCtx = item.getBindingContext() as Context;
      const urlParams = {
        amount: parseInt(this.orderDialog.getModel('order')?.getProperty('/amount') as string),
        id: itemCtx.getProperty('ID')
      };
      console.debug('[debug] calling order action', { functionName, bindingPath: itemCtx && itemCtx.getPath && itemCtx.getPath(), urlParams, ctxObject: itemCtx && itemCtx.getObject && itemCtx.getObject() });
      try {
        if (odataModel && typeof odataModel.callFunction === 'function') {
          await odataModel.callFunction(functionName, {
            context: itemCtx,
            urlParameters: urlParams,
            method: 'POST'
          });
        } else {
          // fallback: POST to the bound action endpoint
          const ctxPath = itemCtx && itemCtx.getPath ? itemCtx.getPath() : '';
          const endpoint = `/odata/v4/admin${ctxPath}/${functionName}`;
          console.debug('[debug] fallback fetch to', endpoint, urlParams);
          const resp = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(urlParams) });
          if (!resp.ok) throw new Error(`fetch ${endpoint} failed: ${resp.status}`);
        }
        console.debug('[debug] order action succeeded for', urlParams.id);
        // attempt to refresh the specific context so UI updates sooner
        try {
          if (itemCtx && typeof (itemCtx as any).refresh === 'function') {
            await (itemCtx as any).refresh();
          }
        } catch (rerr) {
          console.debug('[debug] context refresh failed', String(rerr));
        }
        // optimistic local update: increment amountOrderd in the client model so the table shows the change immediately
        try {
          const cur = itemCtx.getProperty && itemCtx.getProperty('amountOrderd');
          const inc = urlParams.amount || 0;
          if (typeof cur === 'number') {
            const modelForCtx = itemCtx.getModel && itemCtx.getModel();
            if (modelForCtx) {
              try {
                (modelForCtx as any).setProperty(itemCtx.getPath() + '/amountOrderd', cur + inc);
              } catch {
                /* ignore */
              }
            }
          }
        } catch (uerr) {
          console.debug('[debug] optimistic update failed', String(uerr));
        }
      } catch (e) {
        console.error('[debug] order action failed', String(e), e);
        throw e;
      }
    });

    try {
      await Promise.all(promises);
      // Rebind the view's ProductCamera context to force a fresh read of materials from the server
      try {
        const view = this.getView();
        const viewCtx = view && (view as any).getBindingContext && (view as any).getBindingContext();
        if (viewCtx && typeof (viewCtx as any).refresh === 'function') {
          console.debug('[debug] refreshing view binding context to reload materials');
          await (viewCtx as any).refresh();
        } else if (view && typeof view.bindObject === 'function' && viewCtx && viewCtx.getPath) {
          // older fallback: rebind object with expand
          const path = viewCtx.getPath();
          console.debug('[debug] re-binding view to refresh materials', { path });
          view.bindObject({ path, parameters: { $expand: 'materials,installations' } });
        } else {
          // fallback: refresh items binding or model
          const itemsBinding = this.table.getBinding('items');
          if (itemsBinding && typeof (itemsBinding as any).refresh === 'function') {
            (itemsBinding as any).refresh();
          } else {
            this.table.getModel()?.refresh();
          }
        }
      } catch (r) {
        console.warn('[debug] rebind/refresh after order failed, falling back to model.refresh', r);
        this.table.getModel()?.refresh();
      }
    } catch (e) {
      // already logged per-item; surface a warning
      console.warn('[debug] one or more order actions failed', String(e));
    } finally {
      BusyIndicator.hide();
    }
  }
  closeDialog() {
    this.orderDialog.close();
  }

  refresh() {
    try {
      const b = this.table.getBinding('items');
      console.log('[debug] refresh invoked, items binding path:', b && b.getPath && b.getPath());
    } catch (e) {
      console.warn('[debug] refresh: unable to read items binding', e);
    }
    this.table.getModel()?.refresh();
  }

  async produce() {
    // Trigger AdminService.produce bound action on the current ProductCamera
    BusyIndicator.show();
      try {
      const view = this.getView();
      const model = view?.getModel();
      // view is bound in onRouteMatched to a ProductCamera instance
      const bindingContext = view && (view as any).getBindingContext && (view as any).getBindingContext();
      if (!model || !bindingContext) {
        console.warn('[debug] produce: missing model or bindingContext', { model: !!model, bindingContext: !!bindingContext });
        BusyIndicator.hide();
        return;
      }

      const odataModel: any = model;
      const functionName = 'produce';
      console.debug('[debug] calling produce action', { functionName, bindingPath: bindingContext && bindingContext.getPath && bindingContext.getPath(), ctxObject: bindingContext && bindingContext.getObject && bindingContext.getObject() });
      if (odataModel && typeof odataModel.callFunction === 'function') {
        await odataModel.callFunction(functionName, {
          context: bindingContext,
          method: 'POST'
        });
      } else {
        const serviceRoot = '/odata/v4/admin';
        const ctxPath = bindingContext && bindingContext.getPath && bindingContext.getPath();
        const url = `${serviceRoot}${ctxPath}/${functionName}`;
        console.debug('[debug] fallback fetch to', url);
        const resp = await fetch(url, { method: 'POST' });
        if (!resp.ok) {
          const body = await resp.text();
          throw new Error(`HTTP ${resp.status}: ${body}`);
        }
      }
      console.debug('[debug] produce action succeeded');
      // update UI (product stock / processflow)
      try {
        this.refeshProducton();
      } catch (e) {
        console.warn('[debug] refresh processflow failed', String(e));
      }
      // refresh view model
      model.refresh();
    } catch (e) {
      console.error('[debug] produce action failed', String(e), e);
    } finally {
      BusyIndicator.hide();
    }
  }

  refeshProducton() {
    const processFlow = this.byId("processflow") as ProcessFlow;
    processFlow.updateModel();
  }

  async replaceCamera(event: ui5Event) {
    const src = (event.getSource && event.getSource()) as any;
    // Prefer the control's own binding context (button inherits context from row). Fallback to parent or listItem.
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

    // Call AdminService.replace via bound action on the installation
    const model = this.getView()?.getModel();
    const path = bindingContext.getPath();
    if (!model || !path) return;

    try {
      const odataModel: any = model;
      const functionName = 'replace';
      console.debug('[debug] calling replace action', { functionName, bindingPath: bindingContext && (bindingContext as any).getPath && (bindingContext as any).getPath(), id });
      if (odataModel && typeof odataModel.callFunction === 'function') {
        await odataModel.callFunction(functionName, {
          context: bindingContext as any,
          urlParameters: { id },
          method: 'POST'
        });
      } else {
        const serviceRoot = '/odata/v4/admin';
        const ctxPath = bindingContext && (bindingContext as any).getPath && (bindingContext as any).getPath();
        const url = `${serviceRoot}${ctxPath}/${functionName}`;
        console.debug('[debug] fallback fetch to', url, { id });
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        });
        if (!resp.ok) {
          const body = await resp.text();
          throw new Error(`HTTP ${resp.status}: ${body}`);
        }
      }
      console.debug('[debug] replace action succeeded for', id);
    } catch (e) {
      console.error('[debug] replace action failed', String(e), e);
    }
    // refresh installations table
    (this.byId('idInstallationsTable') as Table).getModel()?.refresh();
  }
}
