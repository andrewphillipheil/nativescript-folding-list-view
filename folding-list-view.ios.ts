/*! *****************************************************************************
Copyright (c) 2018 Tangra Inc.
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
***************************************************************************** */
import { Observable } from "data/observable";
import { Length, PercentLength, View, layout } from "ui/core/view";
import { StackLayout } from "ui/layouts/stack-layout";
import { ProxyViewContainer } from "ui/proxy-view-container";
import * as utils from "utils/utils";

import { FoldingListViewBase } from "./folding-list-view-common";

export * from "./folding-list-view-common";

const infinity = layout.makeMeasureSpec(0, layout.UNSPECIFIED);

interface Constraints {
    _constraintTop?: number;
    _constraintLeft?: number;
    _constraintBottom?: number;
    _constraintRight?: number;
}

type ConstraintedView = View & Constraints;

interface FoldingCellView {
    foreground: ConstraintedView;
    container: ConstraintedView;
    index: number;
}

// NOTE: Heights will include constraints (if any) and are in device pixels!
interface FoldingCellHeight {
    foreground: number;
    container: number;
}

export class FoldingListView extends FoldingListViewBase {
    public _ios: UITableView;
    public widthMeasureSpec: number = 0;

    private _dataSource;
    private _delegate;
    private _heights: FoldingCellHeight[];
    private _cellExpanded: boolean[];
    private _preparingCell: boolean;
    private _isDataDirty: boolean;
    private _map: Map<FoldingListViewCell, FoldingCellView>;

    constructor() {
        super();
        this.nativeViewProtected = this._ios = UITableView.new();
        this._ios.registerClassForCellReuseIdentifier(FoldingListViewCell.class(), this._defaultForegroundItemTemplate.key);
        this._ios.separatorColor = utils.ios.getter(UIColor, UIColor.clearColor);
        this._ios.rowHeight = UITableViewAutomaticDimension;
        this._ios.dataSource = this._dataSource = FoldingListViewDataSource.initWithOwner(new WeakRef(this));
        this._delegate = FoldingListViewDelegate.initWithOwner(new WeakRef(this));
        this._heights = new Array<FoldingCellHeight>();
        this._cellExpanded = new Array<boolean>();
        this._map = new Map<FoldingListViewCell, FoldingCellView>();
        this._setNativeClipToBounds();
    }

    public _setNativeClipToBounds() {
        // Always set clipsToBounds for list-view
        this._ios.clipsToBounds = true;
    }

    public onLoaded() {
        super.onLoaded();
        if (this._isDataDirty) {
            this.refresh();
        }
        this._ios.delegate = this._delegate;
    }

    public onUnloaded() {
        this._ios.delegate = null;
        super.onUnloaded();
    }

    public get ios(): UITableView {
        return this._ios;
    }

    public get _childrenCount(): number {
        return this._map.size;
    }

    public eachChildView(callback: (child: View) => boolean): void {
        this._map.forEach((view, key) => {
            callback(view.foreground);
            callback(view.container);
        });
    }

    public scrollToIndex(index: number) {
        this._scrollToIndex(index, false);
    }

    public scrollToIndexAnimated(index: number) {
        this._scrollToIndex(index);
    }

    public refresh() {
        // clear bindingContext when it is not observable because otherwise bindings to items won't reevaluate
        this._map.forEach((view, nativeView) => {
            if (!(view.foreground.bindingContext instanceof Observable)) {
                view.foreground.bindingContext = null;
            }
            
            if (!(view.container.bindingContext instanceof Observable)) {
                view.foreground.bindingContext = null;
            }
        });

        if (this.isLoaded) {
            this._ios.reloadData();
            this.requestLayout();
            this._isDataDirty = false;
        }
        else {
            this._isDataDirty = true;
        }
    }

    // public isItemAtIndexVisible(itemIndex: number): boolean {
    //     const indexes: NSIndexPath[] = Array.from(this._ios.indexPathsForVisibleRows);
    //     return indexes.some(visIndex => visIndex.row === itemIndex);
    // }

    public getHeight(index: number): FoldingCellHeight {
        return this._heights[index];
    }

    public setHeight(index: number, value: FoldingCellHeight): void {
        this._heights[index] = value;
    }

    public getIsCellExpanded(index: number): boolean {
        return this._cellExpanded[index];
    }

    public setIsCellExpanded(index: number, value: boolean): void {
        this._cellExpanded[index] = value;
    }

    public _onFoldedRowHeightPropertyChanged(oldValue: Length, newValue: Length) {
        const value = layout.toDeviceIndependentPixels(this._effectiveFoldedRowHeight);

        if (value > 0) {
            this._ios.estimatedRowHeight = value;
        }

        super._onFoldedRowHeightPropertyChanged(oldValue, newValue);
    }

    public requestLayout(): void {
        // When preparing cell don't call super - no need to invalidate our measure when cell desiredSize is changed.
        if (!this._preparingCell) {
            super.requestLayout();
        }
    }

    public measure(widthMeasureSpec: number, heightMeasureSpec: number): void {
        this.widthMeasureSpec = widthMeasureSpec;
        const changed = (this as any)._setCurrentMeasureSpecs(widthMeasureSpec, heightMeasureSpec);
        super.measure(widthMeasureSpec, heightMeasureSpec);
        if (changed) {
            this._ios.reloadData();
        }
    }

    public onMeasure(widthMeasureSpec: number, heightMeasureSpec: number): void {
        super.onMeasure(widthMeasureSpec, heightMeasureSpec);

        this._map.forEach((cellView, listViewCell) => {
            View.measureChild(
                this,
                cellView.foreground,
                (cellView.foreground as any)._currentWidthMeasureSpec,
                (cellView.foreground as any)._currentHeightMeasureSpec,
            );
            View.measureChild(
                this,
                cellView.container,
                (cellView.container as any)._currentWidthMeasureSpec,
                (cellView.container as any)._currentHeightMeasureSpec,
            );
        });
    }

    public onLayout(left: number, top: number, right: number, bottom: number): void {
        super.onLayout(left, top, right, bottom);

        this._map.forEach((cellView, listViewCell) => {
            // let rowHeight = this._effectiveRowHeight;
            const cellHeight = this.getHeight(cellView.index);
            if (cellHeight) {
                const width = layout.getMeasureSpecSize(this.widthMeasureSpec);
                View.layoutChild(this, cellView.foreground, 0, 0, width, cellHeight.foreground);
                View.layoutChild(this, cellView.container, 0, 0, width, cellHeight.container);
            }
        });
    }

    public _prepareCell(cell: FoldingListViewCell, indexPath: NSIndexPath): FoldingCellHeight {
        let cellHeight: FoldingCellHeight;
        try {
            this._preparingCell = true;

            let foregroundView = cell.foregroundViewTNS;
            if (!foregroundView) {
                foregroundView = this._getForegroundItemTemplate(indexPath.row).createView();
            }

            let containerView = cell.containerViewTNS;
            if (!containerView) {
                containerView = this._getContainerItemTemplate(indexPath.row).createView();
            }

            // TODO
            // this.notify({
            //     eventName: FoldingListView.itemLoadingEvent,
            //     object: this,
            //     index: indexPath.row,
            //     view,
            //     ios: cell,
            //     android: undefined,
            // });

            foregroundView = this._checkAndWrapProxyContainers(foregroundView);
            containerView = this._checkAndWrapProxyContainers(containerView);

            // If cell is reused it have old content - remove it first.
            // Foreground
            if (!cell.foregroundViewTNS) {
                cell.foregroundViewWeakRef = new WeakRef(foregroundView);
                this._prepareConstrainedView(foregroundView);
            }
            else if (cell.foregroundViewTNS !== foregroundView) {
                this._removeContainer(cell);
                cell.foregroundViewTNS.nativeViewProtected.removeFromSuperview();
                cell.foregroundViewWeakRef = new WeakRef(foregroundView);
                this._prepareConstrainedView(foregroundView);
            }
            this._prepareItem(foregroundView, indexPath.row);

            // Container
            if (!cell.containerViewTNS) {
                cell.containerViewWeakRef = new WeakRef(containerView);
                this._prepareConstrainedView(containerView);
            }
            else if (cell.containerViewTNS !== containerView) {
                this._removeContainer(cell);
                cell.containerViewTNS.nativeViewProtected.removeFromSuperview();
                cell.containerViewWeakRef = new WeakRef(containerView);
                this._prepareConstrainedView(containerView);
            }
            this._prepareItem(containerView, indexPath.row);

            const cellView: FoldingCellView = {
                foreground: foregroundView,
                container: containerView,
                index: indexPath.row,
            };
            this._map.set(cell, cellView);

            // We expect that views returned from itemLoading are new (e.g. not reused).
            if (foregroundView && !foregroundView.parent) {
                this._addView(foregroundView);
            }
            if (containerView && !containerView.parent) {
                this._addView(containerView);
            }

            cellHeight = this._layoutCell(cellView);

            const estimatedRowHeight = layout.toDeviceIndependentPixels(cellHeight.foreground);
            if (this._ios.estimatedRowHeight !== estimatedRowHeight) {
                this._ios.estimatedRowHeight = estimatedRowHeight;
            }

            cell.resetNativeViews(cellHeight);
        }
        finally {
            this._preparingCell = false;
        }

        return cellHeight;
    }

    public _removeContainer(cell: FoldingListViewCell): void {
        const foregroundView = cell.foregroundViewTNS;
        const containerView = cell.containerViewTNS;

        // This is to clear the StackLayout that is used to wrap ProxyViewContainer instances.
        if (!(foregroundView.parent instanceof FoldingListView)) {
            this._removeView(foregroundView.parent);
        }
        if (!(containerView.parent instanceof FoldingListView)) {
            this._removeView(containerView.parent);
        }

        // No need to request layout when we are removing cells.
        const preparing = this._preparingCell;
        this._preparingCell = true;
        foregroundView.parent._removeView(foregroundView);
        containerView.parent._removeView(containerView);
        this._preparingCell = preparing;
        this._map.delete(cell);
    }

    // [separatorColorProperty.getDefault](): UIColor {
    //     return this._ios.separatorColor;
    // }
    // [separatorColorProperty.setNative](value: Color | UIColor) {
    //     this._ios.separatorColor = value instanceof Color ? value.ios : value;
    // }

    // [itemTemplatesProperty.getDefault](): KeyedTemplate[] {
    //     return null;
    // }
    // [itemTemplatesProperty.setNative](value: KeyedTemplate[]) {
    //     this._itemTemplatesInternal = new Array<KeyedTemplate>(this._defaultTemplate);
    //     if (value) {
    //         for (let i = 0, length = value.length; i < length; i++) {
    //             this._ios.registerClassForCellReuseIdentifier(ListViewCell.class(), value[i].key);
    //         }
    //         this._itemTemplatesInternal = this._itemTemplatesInternal.concat(value);
    //     }

    //     this.refresh();
    // }

    // [iosEstimatedRowHeightProperty.getDefault](): Length {
    //     return DEFAULT_HEIGHT;
    // }
    // [iosEstimatedRowHeightProperty.setNative](value: Length) {
    //     const nativeView = this._ios;
    //     const estimatedHeight = Length.toDevicePixels(value, 0);
    //     nativeView.estimatedRowHeight = estimatedHeight < 0 ? DEFAULT_HEIGHT : estimatedHeight;
    // }

    private _scrollToIndex(index: number, animated: boolean = true) {
        if (!this._ios) {
            return;
        }

        const itemsLength = this.items ? this.items.length : 0;
        if (itemsLength > 0) {
            if (index < 0) {
                index = 0;
            }
            else if (index >= itemsLength) {
                index = itemsLength - 1;
            }

            this._ios.scrollToRowAtIndexPathAtScrollPositionAnimated(
                NSIndexPath.indexPathForItemInSection(index, 0),
                UITableViewScrollPosition.Top,
                animated,
            );
        }
    }

    private _checkAndWrapProxyContainers(view: View): View {
        // Proxy containers should not get treated as layouts.
        // Wrap them in a real layout as well.
        if (view instanceof ProxyViewContainer) {
            const sp = new StackLayout();
            sp.addChild(view);
            return sp;
        }

        return view;
    }

    private _layoutCell(cellView: FoldingCellView): FoldingCellHeight {
        if (cellView) {
            const measureForegroundSize = View.measureChild(
                this,
                cellView.foreground,
                this.widthMeasureSpec - (cellView.foreground._constraintLeft + cellView.foreground._constraintRight),
                layout.makeMeasureSpec(this._effectiveFoldedRowHeight, layout.EXACTLY),
            );
            const measuredContainerSize = View.measureChild(
                this,
                cellView.container,
                this.widthMeasureSpec,
                infinity,
            );
            const height: FoldingCellHeight = {
                // This is needed since we use this height to return the rowheight to the table view. 
                // Bottom constraints are not applied. 
                foreground: measureForegroundSize.measuredHeight + cellView.foreground._constraintTop,
                container: measuredContainerSize.measuredHeight,
            };
            
            this.setHeight(cellView.index, height);
            
            return height;
        }

        return {
            foreground: this._effectiveFoldedRowHeight,
            container: this._effectiveFoldedRowHeight,
        };
    }

    private _prepareConstrainedView(view: ConstraintedView) {
        view._constraintTop = PercentLength.toDevicePixels(view.marginTop);
        view._constraintLeft = PercentLength.toDevicePixels(view.marginLeft);
        view._constraintBottom = PercentLength.toDevicePixels(view.marginBottom);
        view._constraintRight = PercentLength.toDevicePixels(view.marginRight);
        view.margin = "0";
    }
}

class FoldingListViewCell extends FoldingCell {
    public foregroundViewWeakRef: WeakRef<ConstraintedView>;
    public containerViewWeakRef: WeakRef<ConstraintedView>;

    public get foregroundViewTNS(): ConstraintedView {
        return this.foregroundViewWeakRef ? this.foregroundViewWeakRef.get() : null;
    }

    public get containerViewTNS(): ConstraintedView {
        return this.containerViewWeakRef ? this.containerViewWeakRef.get() : null;
    }

    public willMoveToSuperview(newSuperview: UIView): void {
        const parent = (this.foregroundViewTNS ? this.foregroundViewTNS.parent as FoldingListView : null);

        // When inside ListView and there is no newSuperview this cell is 
        // removed from native visual tree so we remove it from our tree too.
        if (parent && !newSuperview) {
            parent._removeContainer(this);
        }
    }

    public resetNativeViews(cellHeight: FoldingCellHeight) {
        for (let loop = this.contentView.subviews.count - 1; loop >= 0; loop--) {
            this.contentView.subviews.objectAtIndex(loop).removeFromSuperview();
        }

        this._initForegroundView(cellHeight.foreground);
        this._initContainerView(layout.toDeviceIndependentPixels(cellHeight.container));

        this.commonInit();
    }

    private _initForegroundView(height: number) {
        const topConstraintValue = layout.toDeviceIndependentPixels(this.foregroundViewTNS._constraintTop);
        const foregroundView = RotatedView.alloc().initWithFrame(CGRectZero);
        foregroundView.translatesAutoresizingMaskIntoConstraints = false;
        foregroundView.addSubview(this.foregroundViewTNS.nativeViewProtected);

        this.contentView.addSubview(foregroundView);

        NSLayoutConstraint.activateConstraints(NSLayoutConstraint.constraintsWithVisualFormatOptionsMetricsViews(
            `V:[layer(==${layout.toDeviceIndependentPixels(height) - topConstraintValue})]`,
            0,
            null,
            { layer: foregroundView } as any,
        ));
        NSLayoutConstraint.activateConstraints(NSLayoutConstraint.constraintsWithVisualFormatOptionsMetricsViews(
            `H:|-${layout.toDeviceIndependentPixels(this.foregroundViewTNS._constraintLeft)}-[layer]-${layout.toDeviceIndependentPixels(this.foregroundViewTNS._constraintRight)}-|`,
            0,
            null,
            { layer: foregroundView } as any,
        ));
        const top = NSLayoutConstraint.constraintsWithVisualFormatOptionsMetricsViews(
            `V:|-${topConstraintValue}-[layer]`,
            0,
            null,
            { layer: foregroundView } as any,
        );
        NSLayoutConstraint.activateConstraints(top);
        
        this.foregroundView = foregroundView;
        this.foregroundViewTop = top.objectAtIndex(0);
    }

    private _initContainerView(height: number) {
        const containerView = UIView.alloc().initWithFrame(CGRectZero);
        containerView.translatesAutoresizingMaskIntoConstraints = false;
        containerView.addSubview(this.containerViewTNS.nativeViewProtected);

        this.contentView.addSubview(containerView);

        NSLayoutConstraint.activateConstraints(NSLayoutConstraint.constraintsWithVisualFormatOptionsMetricsViews(
            `V:[layer(==${height})]`,
            0,
            null,
            { layer: containerView } as any,
        ));
        NSLayoutConstraint.activateConstraints(NSLayoutConstraint.constraintsWithVisualFormatOptionsMetricsViews(
            "H:|[layer]|",
            0,
            null,
            { layer: containerView } as any,
        ));
        const top = NSLayoutConstraint.constraintsWithVisualFormatOptionsMetricsViews(
            "V:|[layer]",
            0,
            null,
            { layer: containerView } as any,
        );
        NSLayoutConstraint.activateConstraints(top);

        containerView.layoutIfNeeded();

        this.containerView = containerView;
        this.containerViewTop = top.objectAtIndex(0);
    }
}

@ObjCClass(UITableViewDelegate)
class FoldingListViewDelegate extends NSObject implements UITableViewDelegate {
    public static initWithOwner(owner: WeakRef<FoldingListView>): FoldingListViewDelegate {
        const delegate = FoldingListViewDelegate.new() as FoldingListViewDelegate;
        delegate._owner = owner;
        return delegate;
    }

    private _owner: WeakRef<FoldingListView>;
    
    public tableViewHeightForRowAtIndexPath(tableView: UITableView, indexPath: NSIndexPath): number {
        const owner = this._owner.get();
        const cellHeight = owner.getHeight(indexPath.row);

        return layout.toDeviceIndependentPixels(owner.getIsCellExpanded(indexPath.row) ? cellHeight.container : cellHeight.foreground);
    }

    public tableViewDidSelectRowAtIndexPath(tableView: UITableView, indexPath: NSIndexPath): void {
        const cell = tableView.cellForRowAtIndexPath(indexPath) as FoldingListViewCell;
        const owner = this._owner.get();

        if (cell.isAnimating()) {
            return;
        }
        const isExpanded = !owner.getIsCellExpanded(indexPath.row);

        owner.setIsCellExpanded(indexPath.row, isExpanded);
        cell.unfoldAnimatedCompletion(isExpanded, true, null);

        let duration: number = 0;
        if (isExpanded) {
            for (let loop = 0; loop < cell.durationsForCollapsedState.count; loop++) {
                duration = duration + cell.durationsForCollapsedState.objectAtIndex(loop);
            }
            duration /= 2;
        }
        else {
            for (let loop = 0; loop < cell.durationsForExpandedState.count; loop++) {
                duration = duration + cell.durationsForExpandedState.objectAtIndex(loop);
            }
        }
        
        UIView.animateWithDurationDelayOptionsAnimationsCompletion(
            duration,
            0,
            UIViewAnimationOptions.CurveEaseOut,
            () => {
                tableView.beginUpdates();
                tableView.endUpdates();
            },
            null,
        );
    }

    public tableViewWillDisplayCellForRowAtIndexPath(tableView: UITableView, cell: UITableViewCell, indexPath: NSIndexPath) {
        const foldingCell = cell as FoldingListViewCell;
        const owner = this._owner.get();

        foldingCell.unfoldAnimatedCompletion(owner.getIsCellExpanded(indexPath.row), false, null);
    }

}

@ObjCClass(UITableViewDataSource)
class FoldingListViewDataSource extends NSObject implements UITableViewDataSource {
    public static initWithOwner(owner: WeakRef<FoldingListView>): FoldingListViewDataSource {
        const dataSource = FoldingListViewDataSource.new() as FoldingListViewDataSource;
        dataSource._owner = owner;
        return dataSource;
    }

    private _owner: WeakRef<FoldingListView>;

    public tableViewNumberOfRowsInSection(tableView: UITableView, section: number) {
        const owner = this._owner.get();
        return (owner && owner.items) ? owner.items.length : 0;
    }

    public tableViewCellForRowAtIndexPath(tableView: UITableView, indexPath: NSIndexPath): UITableViewCell {
        // We call this method because ...ForIndexPath calls tableViewHeightForRowAtIndexPath immediately (before we can prepare and measure it).
        const owner = this._owner.get();
        let cell: FoldingListViewCell;
        if (owner) {
            const template = owner._getForegroundItemTemplate(indexPath.row);
            cell = (tableView.dequeueReusableCellWithIdentifier(template.key) || FoldingListViewCell.new()) as FoldingListViewCell;
            
            const cellHeight = owner._prepareCell(cell, indexPath);
            const width = layout.getMeasureSpecSize(owner.widthMeasureSpec);

            const foregroundView = cell.foregroundViewTNS;
            if (foregroundView && (foregroundView as any).isLayoutRequired) {
                // Arrange cell views. We do it here instead of _layoutCell because _layoutCell is called 
                // from 'tableViewHeightForRowAtIndexPath' method too (in iOS 7.1) and we don't want to arrange the fake cell.
                View.layoutChild(owner, foregroundView, 0, 0, width - (foregroundView._constraintLeft + foregroundView._constraintRight), cellHeight.foreground - foregroundView._constraintTop);
            }

            const containerView: View = cell.containerViewTNS;
            if (containerView && (containerView as any).isLayoutRequired) {
                // Arrange cell views. We do it here instead of _layoutCell because _layoutCell is called 
                // from 'tableViewHeightForRowAtIndexPath' method too (in iOS 7.1) and we don't want to arrange the fake cell.
                View.layoutChild(owner, containerView, 0, 0, width, cellHeight.container);
            }

            cell.itemCount = owner.foldsCount;

            if (cell.durationsForCollapsedState.count < owner.foldsCount) {
                cell.durationsForCollapsedState = Array(owner.foldsCount).fill(0.33) as any;
            }
            if (cell.durationsForExpandedState.count < owner.foldsCount) {
                cell.durationsForExpandedState = Array(owner.foldsCount).fill(0.33) as any;
            }
        }
        else {
            cell = FoldingListViewCell.new() as FoldingListViewCell;
        }
        return cell;
    }
}