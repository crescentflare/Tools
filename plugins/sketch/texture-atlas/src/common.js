import sketch from 'sketch'

// --
// Main entry
// --

export default function process(layerSpacing) {
    // Get selected layers
    const doc = sketch.getSelectedDocument()
    const selectedLayers = doc.selectedLayers

    // Show alert if no layers are selected
    if (selectedLayers.length == 0) {
        sketch.UI.alert("No layers selected", "Select an artboard (or a layer within an artboard) to arrange the layers into a packed texture atlas")
        return
    }

    // Collect artboards
    var duplicateArtboards = []
    for (var i = 0; i < selectedLayers.length; i++) {
        if (selectedLayers.layers[i].type == "Artboard") {
            duplicateArtboards.push(selectedLayers.layers[i])
        } else if (selectedLayers.layers[i].getParentArtboard()) {
            duplicateArtboards.push(selectedLayers.layers[i].getParentArtboard())
        }
    }

    // Filter out duplicates
    var artboards = duplicateArtboards.filter(function(item, pos, self) {
        for (var i = 0; i < self.length; i++) {
            if (self[i].id == item.id) {
                return i == pos
            }
        }
        return false
    })

    // Abort if no artboard was found
    if (artboards.length == 0) {
        sketch.UI.alert("No artboards found", "The selected layers are not part of an artboard")
        return
    }

    // Collect layer positions, show in text for debugging
    for (var i = 0; i < artboards.length; i++) {
        arrangeArtboardAtlas(artboards[i], layerSpacing)
    }
}

var arrangeArtboardAtlas = function(artboard, layerSpacing) {
    var grid = new FlexiblePlacementGrid(0, 0, layerSpacing)
    var arrangeLayers = artboard.layers.slice()
    var placedLayers = []
    arrangeLayers.sort(function(a, b) { return Math.max(a.frame.width, a.frame.height) < Math.max(b.frame.width, b.frame.height) })
    for (var i = 0; i < arrangeLayers.length; i++) {
        var layer = arrangeLayers[i]
        grid.increaseSizeIfNeeded(layer.frame.width, layer.frame.height)
        for (var check = 0; check < 64; check++) {
            var placement = grid.findBestPosition(layer.frame.width + layerSpacing, layer.frame.height + layerSpacing)
            if (placement) {
                grid.fillGrid(placement[0], placement[1], placement[0] + layer.frame.width + layerSpacing, placement[1] + layer.frame.height + layerSpacing)
                placedLayers.push({ name: layer.name, x: placement[0], y: placement[1], width: layer.frame.width, height: layer.frame.height })
                layer.frame.offset(placement[0] - layer.frame.x, placement[1] - layer.frame.y)
                break
            } else {
                grid.doubleSize()
            }
        }
    }
    if (grid.gridWidth > 0 && grid.gridHeight > 0) {
        artboard.frame.width = grid.gridWidth - layerSpacing
        artboard.frame.height = grid.gridHeight - layerSpacing
    }
}


// --
// Grid helper class
// --

class FlexiblePlacementGrid {

    constructor(width, height, sideSpacing) {
        this.sideSpacing = sideSpacing || 0
        this.horizontalGrid = [ 0 ]
        this.verticalGrid = [ 0 ]
        this.gridFlags = [[]]
        this.increaseWidth(width)
        this.increaseHeight(height)
    }

    get gridWidth() {
        return this.horizontalGrid.length > 0 ? this.horizontalGrid[this.horizontalGrid.length - 1] : 0
    }

    get gridHeight() {
        return this.verticalGrid.length > 0 ? this.verticalGrid[this.verticalGrid.length - 1] : 0
    }

    increaseSizeIfNeeded(width, height) {
        if (this.gridWidth < width) {
            var expandingWidth = this.getExpandingSize(width, true)
            if (expandingWidth) {
                this.increaseWidth(expandingWidth)
            }
        }
        if (this.gridHeight < height) {
            var expandingHeight = this.getExpandingSize(height, true)
            if (expandingHeight) {
                this.increaseHeight(expandingHeight)
            }
        }
    }

    doubleSize() {
        if (this.gridHeight < this.gridWidth) {
            this.increaseHeight(this.gridHeight * 2 - this.sideSpacing)
        } else {
            this.increaseWidth(this.gridWidth * 2 - this.sideSpacing)
        }
    }

    increaseWidth(newWidth) {
        if (newWidth > this.horizontalGrid[this.horizontalGrid.length - 1]) {
            this.horizontalGrid.push(newWidth)
            for (var i = 0; i < this.gridFlags.length; i++) {
                this.gridFlags[i].push(0)
            }
        }
    }

    increaseHeight(newHeight) {
        if (newHeight > this.verticalGrid[this.verticalGrid.length - 1]) {
            var row = []
            for (var i = 0; i < this.horizontalGrid.length; i++) {
                row.push(0)
            }
            this.verticalGrid.push(newHeight)
            this.gridFlags.push(row)
        }
    }

    sliceHorizontal(atVerticalPosition) {
        for (var i = 0; i < this.verticalGrid.length; i++) {
            if (i > 0 && this.verticalGrid[i - 1] < atVerticalPosition && this.verticalGrid[i] > atVerticalPosition) {
                this.verticalGrid.splice(i, 0, atVerticalPosition)
                this.gridFlags.splice(i, 0, this.gridFlags[i - 1].slice())
                break
            }
        }
    }

    sliceVertical(atHorizontalPosition) {
        for (var i = 0; i < this.horizontalGrid.length; i++) {
            if (i > 0 && this.horizontalGrid[i - 1] < atHorizontalPosition && this.horizontalGrid[i] > atHorizontalPosition) {
                this.horizontalGrid.splice(i, 0, atHorizontalPosition)
                for (var j = 0; j < this.gridFlags.length; j++) {
                    this.gridFlags[j].splice(i, 0, this.gridFlags[j][i - 1])
                }
                break
            }
        }
    }

    tryMergeHorizontal() {
        if (this.horizontalGrid.length > 1) {
            for (var x = this.horizontalGrid.length - 3; x >= 0; x--) {
                var foundDifference = false
                for (var y = 0; y < this.verticalGrid.length - 1; y++) {
                    if (this.gridFlags[y][x] != this.gridFlags[y][x + 1]) {
                        foundDifference = true
                        break
                    }
                }
                if (!foundDifference) {
                    this.horizontalGrid.splice(x + 1, 1)
                    for (var y = 0; y < this.verticalGrid.length - 1; y++) {
                        this.gridFlags[y].splice(x + 1, 1)
                    }
                }
            }
        }
    }
    
    tryMergeVertical() {
        console.log(this.gridWidth, this.gridHeight)
        if (this.verticalGrid.length > 1) {
            for (var y = this.verticalGrid.length - 3; y >= 0; y--) {
                var foundDifference = false
                for (var x = 0; x < this.horizontalGrid.length; x++) {
                    if (this.gridFlags[y][x] != this.gridFlags[y + 1][x]) {
                        foundDifference = true
                        break
                    }
                }
                if (!foundDifference) {
                    this.verticalGrid.splice(y + 1, 1)
                    this.gridFlags.splice(y + 1, 1)
                }
            }
        }
    }

    fillGrid(minX, minY, maxX, maxY) {
        // Abort for invalid rectangles
        if (minX < 0 || minY < 0 || maxX <= minX || maxY <= minY) {
            return false
        }
        
        // Slice or expand horizontal if needed
        if (this.horizontalGrid.find(function(item) { return item == minX } ) == null) {
            if (minX > this.gridWidth) {
                var newSize = this.getExpandingSize(minX, true)
                if (newSize) {
                    this.increaseWidth(newSize)
                } else {
                    return false
                }
            }
            this.sliceVertical(minX)
        }
        if (this.horizontalGrid.find(function(item) { return item == maxX } ) == null) {
            if (maxX > this.gridWidth) {
                var newSize = this.getExpandingSize(maxX, true)
                if (newSize) {
                    this.increaseWidth(newSize)
                } else {
                    return false
                }
            }
            this.sliceVertical(maxX)
        }

        // Slice or expand vertical if needed
        if (this.verticalGrid.find(function(item) { return item == minY } ) == null) {
            if (minY > this.gridHeight) {
                var newSize = this.getExpandingSize(minY, true)
                if (newSize) {
                    this.increaseHeight(newSize)
                } else {
                    return false
                }
            }
            this.sliceHorizontal(minY)
        }
        if (this.verticalGrid.find(function(item) { return item == maxY } ) == null) {
            if (maxY > this.gridHeight) {
                var newSize = this.getExpandingSize(maxY, true)
                if (newSize) {
                    this.increaseHeight(newSize)
                } else {
                    return false
                }
            }
            this.sliceHorizontal(maxY)
        }
        
        // Find matching grid and fill
        var startX = this.horizontalGrid.findIndex(function(item) { return item == minX } )
        var endX = this.horizontalGrid.findIndex(function(item) { return item == maxX } )
        var startY = this.verticalGrid.findIndex(function(item) { return item == minY } )
        var endY = this.verticalGrid.findIndex(function(item) { return item == maxY } )
        if (startX != null && endX != null && startY != null && endY != null) {
            for (var x = startX; x < endX; x++) {
                for (var y = startY; y < endY; y++) {
                    this.gridFlags[y][x] = 1
                }
            }
        }
        
        // Try merging grid for effiency
        this.tryMergeHorizontal()
        this.tryMergeVertical()
        return true
    }

    findBestPosition(width, height) {
        // Return early if the entire size is too big to fit
        if (width > this.gridWidth || height > this.gridHeight) {
            return null
        }
        
        // Iterate through the grid to find the best position
        var bestPositionX = -1
        var bestPositionY = -1
        var lastPositionValue = -1
        for (var y = 0; y < this.verticalGrid.length - 1; y++) {
            for (var x = 0; x < this.horizontalGrid.length - 1; x++) {
                var value = this.getPositionValue(x, y, width, height)
                if (value > lastPositionValue) {
                    bestPositionX = x
                    bestPositionY = y
                    lastPositionValue = value
                }
            }
        }
        
        // Return position or null when not found
        if (bestPositionX >= 0 && bestPositionY >= 0) {
            return [ this.horizontalGrid[bestPositionX], this.verticalGrid[bestPositionY] ]
        }
        return null
    }

    getPositionValue(x, y, width, height) {
        // Abort early if the given size is too big to fit
        if (x >= 0 && x < this.horizontalGrid.length && y >= 0 && y < this.verticalGrid.length && width > 0 && height > 0) {
            if (this.horizontalGrid[x] + width > this.horizontalGrid[this.horizontalGrid.length - 1] || this.verticalGrid[y] + height > this.verticalGrid[this.verticalGrid.length - 1]) {
                return -1
            }
        } else {
            return -1
        }
        
        // Determine end positions
        var that = this
        var endX = this.horizontalGrid.findIndex(function(item) { return item >= that.horizontalGrid[x] + width } ) || -1
        var endY = this.verticalGrid.findIndex(function(item) { return item >= that.verticalGrid[y] + height }) || -1
        
        // Check grid and return -1 when it hits an occupied tile
        for (var checkY = y; checkY < endY; checkY++) {
            for (var checkX = x; checkX < endX; checkX++) {
                if (this.gridFlags[checkY][checkX] > 0) {
                    return -1
                }
            }
        }
        
        // Check for empty tiles adjacent to the placement, a tight fit will give a higher value
        var hasLeftEmpty = false
        var hasRightEmpty = false
        var hasUpEmpty = false
        var hasDownEmpty = false
        for (var checkY = y; checkY < endY; checkY++) {
            if (x > 0 && this.gridFlags[checkY][x - 1] == 0) {
                hasLeftEmpty = true
            }
            if (endX < this.horizontalGrid.length - 1 && this.gridFlags[checkY][endX] == 0) {
                hasRightEmpty = true
            }
        }
        for (var checkX = x; checkX < endX; checkX++) {
            if (y > 0 && this.gridFlags[y - 1][checkX] == 0) {
                hasUpEmpty = true
            }
            if (endY < this.verticalGrid.length - 1 && this.gridFlags[endY][checkX] == 0) {
                hasDownEmpty = true
            }
        }
        if (this.horizontalGrid[endX] > this.horizontalGrid[x] + width) {
            hasRightEmpty = true
        }
        if (this.verticalGrid[endY] > this.verticalGrid[y] + height) {
            hasDownEmpty = true
        }

        // Return result
        var value = 0
        if (!hasLeftEmpty && !hasRightEmpty) {
            value += 1
        }
        if (!hasUpEmpty && !hasDownEmpty) {
            value += 1
        }
        return value
    }

    getExpandingSize(size, power2Sizing) {
        if (power2Sizing) {
            var that = this
            return [ 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536 ].find(function(item) { return item >= size - that.sideSpacing } ) + this.sideSpacing
        }
        return size > 0 ? size : null
    }

}
