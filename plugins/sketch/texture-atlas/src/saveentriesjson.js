import sketch from 'sketch'
// documentation: https://developer.sketchapp.com/reference/api/

// --
// Main entry
// --

export default function() {
    // Get selected layers
    const doc = sketch.getSelectedDocument()
    const selectedLayers = doc.selectedLayers

    // Show alert if no layers are selected
    if (selectedLayers.length == 0) {
        sketch.UI.alert("No layers selected", "Select a single artboard (or a layer within an artboard) to save the atlas entries as a JSON file")
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

    // Also abort if multiple artboards were found
    if (artboards.length > 1) {
        sketch.UI.alert("Multiple artboards selected", "You can only save entries for one artboard at a time")
        return
    }

    // Prepare dialog
    var artboard = artboards[0]
    var dialog = NSSavePanel.savePanel()
    dialog.setNameFieldStringValue(artboard.name)
    dialog.allowedContentTypes = [UTType.typeWithFilenameExtension("json")]

    // Show
    if (dialog.runModal()) {
        saveFile(artboard, dialog.URL().path())
    }
}

var saveFile = function(artboard, path) {
    // Determine multiplier
    var multiplier = 1
    var exportFormats = artboard.exportFormats
    if (exportFormats && exportFormats.length == 1 && exportFormats[0].size.length > 1) {
        var exportFormat = exportFormats[0];
        if (exportFormat.size.substring(exportFormat.size.length - 1) == "x") {
            multiplier = parseFloat(exportFormat.size.substring(0, exportFormat.size.length - 1));
        }
    }

    // Set up entries
    var entries = [];
    var usedWidth = 0;
    var usedHeight = 0;
    var artboardWidth = Math.round(artboard.frame.width * multiplier);
    var artboardHeight = Math.round(artboard.frame.height * multiplier);
    for (var i = 0; i < artboard.layers.length; i++) {
        entries.push({
            "identifier": artboard.layers[i].name,
            "x": Math.round(artboard.layers[i].frame.x * multiplier),
            "y": Math.round(artboard.layers[i].frame.y * multiplier),
            "width": Math.round(artboard.layers[i].frame.width * multiplier),
            "height": Math.round(artboard.layers[i].frame.height * multiplier)
        })
        usedWidth = Math.max(usedWidth, Math.round((artboard.layers[i].frame.x + artboard.layers[i].frame.width) * multiplier))
        usedHeight = Math.max(usedHeight, Math.round((artboard.layers[i].frame.y + artboard.layers[i].frame.height) * multiplier))
    }

    // Save json
    var json = { "usedWidth": usedWidth, "usedHeight": usedHeight, "totalWidth": artboardWidth, "totalHeight": artboardHeight, "paddedWidth": getPaddedSize(artboardWidth), "paddedHeight": getPaddedSize(artboardHeight), "entries": entries }
    const string = NSString.stringWithFormat("%@", JSON.stringify(json, 0, 2))
    string.writeToFile_atomically(path, true)
}

var getPaddedSize = function(size) {
    return [ 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536 ].find(function(item) { return item >= size } );
}
