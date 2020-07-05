// Can automatically transfer commits between repositories using patches
// --

'use strict';

// NodeJS requires
const child_process = require('child_process');
const fs = require('fs');

// Patcher config
var patcherConfig = {};


// --
// Git commit
// --

class Commit {

    // Members
    parentHashes = [];
    hash = "";
    comment = "";
    number = 0;
    mergeCommit = false;
    tag;

    // Constructor
    constructor(lineNumber, line) {
        // Split off comment from hashes
        var hashSeparator = line.indexOf(": ");
        var hashesLine = line;
        if (hashSeparator >= 0) {
            hashesLine = line.substring(0, hashSeparator);
            this.comment = line.substring(hashSeparator + 2);
        }

        // Split of parent hashes
        var parentOpener = hashesLine.indexOf(" (");
        var parentCloser = hashesLine.indexOf(")");
        if (parentOpener >= 0 && parentCloser >= 0) {
            var parentHashesLine = hashesLine.substring(parentOpener + 2, parentCloser);
            this.hash = hashesLine.substring(0, parentOpener);
            if (parentHashesLine.length > 0) {
                this.parentHashes = parentHashesLine.split(" ");
            }
        } else {
            this.hash = hashesLine;
        }

        // Store commit number
        this.number = lineNumber;

        // Mark as merge commit (if needed)
        this.mergeCommit = this.parentHashes.length > 1;
    }

    // Try to obtain a merged branch name from a git commit
    getMergedBranchName = function() {
        var firstQuotePosition = this.comment.indexOf("'");
        var lastQuotePosition = this.comment.lastIndexOf("'");
        if (firstQuotePosition >= 0 && lastQuotePosition >= 0) {
            return this.comment.substring(firstQuotePosition + 1, lastQuotePosition);
        }
        return null;
    }

}


// --
// Git commit merge
// --

class CommitMerge {

    // Members
    branch = null;
    comment = "unknown";

    // Constructor
    constructor(branch, comment) {
        this.branch = branch;
        this.comment = comment;
    }

}


// --
// Git commit branch
// --

class CommitBranch {

    // Members
    commits = [];
    name = "unknown";
    sourceBranch = null;
    closed = false;
    merges = {};

    // Constructor
    constructor(sourceBranch, commit) {
        if (commit) {
            this.commits.push(commit);
        }
        this.sourceBranch = sourceBranch;
    }

    // Get last commit
    getLastCommit = function() {
        return this.commits[this.commits.length - 1];
    }

    // Get the number of the first commit
    getFirstCommitNumber = function() {
        if (this.commits.length > 0) {
            return this.commits[0].number;
        }
        return 0;
    }

    // Check if the branch contains a commit with the given hash
    containsCommitHash = function(commitHash) {
        for (var i = 0; i < this.commits.length; i++) {
            if (this.commits[i].hash == commitHash) {
                return true;
            }
        }
        return false;
    }

    // Check if the branch contains a commit with the given number
    containsCommitNumber = function(number) {
        for (var i = 0; i < this.commits.length; i++) {
            if (this.commits[i].number == number) {
                return true;
            }
        }
        return false;
    }

    // Mark the branch as merged (it will be closed until another commit comes in)
    markMerged = function(mergeBranch, comment) {
        var mergeCommitIndex = this.commits.length - 1;
        var merge = new CommitMerge(mergeBranch, comment);
        this.closed = true;
        if (this.merges[mergeCommitIndex]) {
            this.merges[mergeCommitIndex].push(merge);
        } else {
            this.merges[mergeCommitIndex] = [ merge ];
        }
    }

    // Split off a new branch after the given hash
    splitAfterHash = function(hash) {
        // Find the start index of the commits to split off
        var startIndex = -1;
        for (var i = 0; i < this.commits.length; i++) {
            if (this.commits[i].hash == hash) {
                startIndex = i;
                break;
            }
        }

        // Create branch and move commits
        var splitBranch = new CommitBranch(this);
        for (var i = startIndex + 1; i < this.commits.length; i++) {
            splitBranch.commits.push(this.commits[i]);
        }
        this.commits.splice(startIndex + 1);

        // Move merges and return result
        var removeIndices = [];
        for (var commitIndex in this.merges) {
            if (commitIndex >= this.commits.length) {
                splitBranch.merges[commitIndex - this.commits.length] = this.merges[commitIndex];
                removeIndices.push(commitIndex);
            }
        }
        for (var i = 0; i < removeIndices.length; i++) {
            delete this.merges[removeIndices[i]];
        }
        return splitBranch;
    }

    // Transfer merge targets to a new branch above a certain commit number
    transferMerges = function(fromBranch, toBranch, aboveCommitNumber) {
        for (var commitIndex in this.merges) {
            if (this.commits[commitIndex].number > aboveCommitNumber) {
                var checkMerges = this.merges[commitIndex];
                for (var i = 0; i < checkMerges.length; i++) {
                    var mergeBranch = checkMerges[i].branch;
                    if (mergeBranch === fromBranch) {
                        this.merges[commitIndex][i].branch = toBranch;
                    }
                }
            }
        }
        if (this.commits.length > 0 && this.commits[0].number > aboveCommitNumber) {
            if (this.sourceBranch == fromBranch) {
                this.sourceBranch = toBranch;
            }
        }
    }

    // Returns a debug object for logging information
    debugObject = function() {
        // Object map helper function
        const objectMap = (obj, fn) =>
            Object.fromEntries(
                Object.entries(obj).map(
                    ([k, v], i) => [k, fn(v, k, i)]
                )
            )

        // Return result
        return {
            name: this.name,
            sourceBranch: this.sourceBranch ? this.sourceBranch.name : "none",
            commits: this.commits.map(item => {
                if (item.tag) {
                    return item.comment + " -> " + item.tag;
                }
                return item.comment
            }),
            merges: objectMap(this.merges, item => { return item.map(subItem => { return subItem.branch.name + " (" + subItem.comment + ")" }).join(", ") }),
            closed: this.closed
        };
    }

}


// --
// Git commit collector
// --

class CommitCollector {

    // Members
    branches = [];
    
    // Constructor
    constructor(source) {
        this.source = source;
    }

    // Find a branch with the given commit hash
    findBranchWithCommitHash = function(commitHash) {
        for (var i = 0; i < this.branches.length; i++) {
            if (this.branches[i].containsCommitHash(commitHash)) {
                return this.branches[i];
            }
        }
        return null;
    }

    // Find a branch which last commit has the given commit hash
    findBranchWithLastCommitHash = function(commitHash) {
        for (var i = 0; i < this.branches.length; i++) {
            var branch = this.branches[i];
            if (branch.commits.length > 0) {
                if (branch.commits[branch.commits.length - 1].hash == commitHash) {
                    return branch;
                }
            }
        }
        return null;
    }

    // Find a branch containing a commit with a certain number
    findBranchWithCommitNumber(number) {
        for (var i = 0; i < this.branches.length; i++) {
            if (this.branches[i].containsCommitNumber(number)) {
                return this.branches[i];
            }
        }
        return null;
    }

    // Go through the commit log and split branches based on merge commits (branch information could be incomplete)
    gatherCommits = function(callback) {
        var that = this;
        child_process.exec(
            'cd ' + this.source + ' && git log --branches --pretty=format:"%H (%P): %s" --reverse',
            function(error, stdout, sterr) {
                if (!error) {
                    var lines = stdout.split("\n");
                    var foundError = false;
                    for (var i = 0; i < lines.length; i++) {
                        var commit = new Commit(i, lines[i]);
                        if (commit.parentHashes.length <= 0) {
                            that.branches.push(new CommitBranch(null, commit));
                        } else if (commit.parentHashes.length > 1) {
                            var destinationBranch = that.findBranchWithCommitHash(commit.parentHashes[0]);
                            if (destinationBranch) {
                                for (var j = 1; j < commit.parentHashes.length; j++) {
                                    var sourceBranch = that.findBranchWithCommitHash(commit.parentHashes[j]);
                                    if (sourceBranch) {
                                        // Transfer commits if the branch couldn't be detected earlier
                                        if (sourceBranch === destinationBranch) {
                                            // Branch off
                                            var newBranch = sourceBranch.splitAfterHash(commit.parentHashes[0]);
                                            that.branches.push(newBranch);
                                            sourceBranch = newBranch;

                                            // Transfer merges that were made off the new branch
                                            for (var k = 0; k < that.branches.length; k++) {
                                                that.branches[k].transferMerges(destinationBranch, newBranch, newBranch.commits[0].number);
                                            }
                                        }

                                        // Give the branch a name, mark a merge and put the merge commit in the destination branch
                                        var branchName = commit.getMergedBranchName();
                                        if (branchName) {
                                            sourceBranch.name = branchName;
                                        }
                                        sourceBranch.markMerged(destinationBranch, commit.comment);
                                        destinationBranch.commits.push(commit);
                                    } else {
                                        console.log("Error finding source branch for hash:", commit.parentHashes[0]);
                                        foundError = true;
                                    }
                                }
                            } else {
                                console.log("Error finding destination branch for hash:", commit.parentHashes[0]);
                                foundError = true;
                            }
                        } else {
                            var foundParent = false;
                            var doubleParent = false;
                            that.branches.forEach(branch => {
                                if (commit.parentHashes[0] == branch.getLastCommit().hash) {
                                    if (!foundParent) {
                                        branch.commits.push(commit);
                                        branch.closed = false;
                                        foundParent = true;
                                    } else {
                                        doubleParent = true;
                                    }
                                }
                            });
                            if (!foundParent || doubleParent) {
                                console.log("Error matching parent hashes:", foundParent, doubleParent);
                                foundError = true;
                            }
                        }
                        if (foundError) {
                            break;
                        }
                    }
                    callback(!foundError);
                } else {
                    console.log(sterr);
                    callback(false);
                }
            }
        );
    }

    // Enrich branches with commit information (recursive function)
    gatherBranchTipHashes(branchNames, callback, branchInfo, index) {
        // Return when done traversing all the branches
        var checkIndex = index || 0;
        if (checkIndex >= branchNames.length) {
            callback(branchInfo);
            return;
        }

        // Get commit hash and continue
        var fillBranchInfo = branchInfo || {};
        var that = this;
        child_process.exec(
            'cd ' + this.source + ' && git log -n 1 --pretty=format:"%H" ' + branchNames[checkIndex],
            function(error, stdout, sterr) {
                if (!error) {
                    fillBranchInfo[branchNames[checkIndex]] = stdout;
                    that.gatherBranchTipHashes(branchNames, callback, fillBranchInfo, checkIndex + 1)
                } else {
                    console.log(sterr);
                    callback(null);
                }
            }
        );
    }

    // Gather branches still open
    gatherActiveBranches = function(callback) {
        var that = this;
        child_process.exec(
            'cd ' + this.source + ' && git branch --format="%(refname:short)"',
            function(error, stdout, sterr) {
                if (!error) {
                    var branchNames = stdout.split("\n").filter(item => { return item.length > 0 } );
                    that.gatherBranchTipHashes(branchNames, function(branchInfo) {
                        callback(branchInfo);
                    })
                } else {
                    console.log(sterr);
                    callback(null);
                }
            }
        );
    }

    // Gather tags
    gatherTags = function(callback) {
        child_process.exec(
            'cd ' + this.source + ' && git log --pretty=format:"%H %D" --tags --no-walk',
            function(error, stdout, sterr) {
                if (!error) {
                    var tagLines = stdout.split("\n");
                    var tags = {};
                    tagLines.forEach( tagLine => {
                        var spacePos = tagLine.indexOf(" ");
                        if (spacePos >= 0) {
                            var hash = tagLine.substring(0, spacePos);
                            var tagLink = tagLine.substring(spacePos + 1);
                            var commaPos = tagLink.indexOf(",");
                            if (commaPos >= 0) {
                                tagLink = tagLink.substring(0, commaPos);
                            }
                            tagLink = tagLink.replace("tag:", "");
                            tagLink = tagLink.trim();
                            tags[hash] = tagLink;
                        }
                    });
                    callback(tags);
                } else {
                    console.log(sterr);
                    callback(null);
                }
            }
        );
    }

    // Gather the complete commit history
    gatherHistory = function(callback) {
        var that = this;
        this.gatherCommits(function(success) {
            that.gatherActiveBranches(function(branchInfo) {
                // Enrich branch information with active branches
                if (branchInfo) {
                    for (var key in branchInfo) {
                        var branchHash = branchInfo[key];
                        var bestMatch = that.findBranchWithLastCommitHash(branchHash);
                        if (bestMatch) {
                            bestMatch.name = key;
                        } else {
                            var otherMatch = that.findBranchWithCommitHash(branchHash);
                            if (otherMatch) {
                                var newBranch = otherMatch.splitAfterHash(branchHash);
                                that.branches.push(newBranch);
                                otherMatch.name = key;
                            } else {
                                callback(false);
                                return;
                            }
                        }
                    }
                } else {
                    callback(false);
                    return;
                }

                // Enrich commit information with tags
                that.gatherTags(function(tags) {
                    if (tags) {
                        // Apply tags
                        for (var tagHash in tags) {
                            that.branches.forEach(branch => {
                                branch.commits.forEach(commit => {
                                    if (commit.hash == tagHash) {
                                        commit.tag = tags[tagHash];
                                    }
                                });
                            });
                        };

                        // Continue
                        that.branches.sort(function(first, second) {
                            return first.getFirstCommitNumber() - second.getFirstCommitNumber();
                        });
                        callback(success);
                    } else {
                        callback(false);
                    }
                });
            })
        })
    }

    // Get a range of commit numbers for the given branch
    getCommitNumbersForBranch = function(branchName) {
        for (var i = 0; i < this.branches.length; i++) {
            var branch = this.branches[i];
            if (branch.name == branchName && branch.commits.length > 0) {
                return [ branch.commits[0].number, branch.commits[branch.commits.length - 1].number ];
            }
        }
        return [];
    }

    // Return a commit number for the given hash
    getCommitNumberForHash = function(hash) {
        var commitNumber = -1;
        for (var i = 0; i < this.branches.length; i++) {
            var branch = this.branches[i];
            for (var j = 0; j < branch.commits.length; j++) {
                if (branch.commits[j].hash.startsWith(hash)) {
                    if (commitNumber >= 0) {
                        return -1; // Duplicate
                    }
                    commitNumber = branch.commits[j].number;
                }
            }
        }
        return commitNumber;
    }

    // Get a range of commit numbers for the start and end hashes
    getCommitNumbersForHashRange = function(startHash, endHash) {
        var start = getCommitNumberForHash(startHash);
        var end = getCommitNumberForHash(endHash);
        if (start >= 0 && end >= 0 && start <= end) {
            return [ start, end ];
        }
        return [];
    }

}


// --
// Patch task
// --

class PatchTask {

    // Members
    source = "";
    dest = "";
    type = "unknown";
    identifier = "unknown";
    sourceIdentifier = "unknown";
    comment = "";
    
    // Constructor
    constructor(source, dest, type, identifier, sourceIdentifier, comment) {
        this.source = source;
        this.dest = dest;
        this.type = type;
        this.identifier = identifier;
        this.sourceIdentifier = sourceIdentifier;
        this.comment = comment || "";
    }

    // Generic apply function, do task based on type
    apply = function(callback) {
        switch(this.type) {
            case "patch":
                this.patchCommit(callback);
                break;
            case "branch":
                this.switchBranch(callback);
                break;
            case "merge":
                this.mergeBranch(callback);
                break;
            case "close":
                this.closeBranch(callback);
                break;
            case "tag":
                this.tagCommit(callback);
                break;
            default:
                console.log("Task of type '" + type + "' is not implemented");
                callback(false);
                break;
        }
    }

    // Task type: patching
    patchCommit = function(callback) {
        var that = this;
        child_process.exec(
            'cd ' + that.source + ' && git format-patch ' + that.identifier + ' -1 --stdout',
            { maxBuffer: 1024 * 1024 * 64 },
            function(error, stdout, sterr) {
                if (!error) {
                    fs.writeFile("tmp.patch", stdout, function(error) {
                        if (!error) {
                            child_process.exec(
                                'cd ' + that.dest + ' && git apply --check ../tmp.patch',
                                function(error, stdout, sterr) {
                                    if (!error) {
                                        child_process.exec(
                                            'cd ' + that.dest + ' && git am ../tmp.patch',
                                            function(error, stdout, sterr) {
                                                if (!error) {
                                                    console.log("Patched commit:", that.comment);
                                                    fs.unlink("tmp.patch", function() {
                                                        callback(true);
                                                    })
                                                } else {
                                                    fs.unlink("tmp.patch", function(){});
                                                    console.log(sterr);
                                                    callback(false);
                                                }
                                            }
                                        );
                                    } else {
                                        fs.unlink("tmp.patch", function(){});
                                        console.log(sterr);
                                        callback(false);
                                    }
                                }
                            );
                        } else {
                            console.log(error);
                            callback(false);
                        }
                    }); 
                } else {
                    console.log(sterr);
                    callback(false);
                }
            }
        );
    }

    // Task type: switch branch
    switchBranch = function(callback) {
        var that = this;
        child_process.exec(
            'cd ' + that.dest + ' && git checkout ' + that.identifier,
            { maxBuffer: 1024 * 1024 * 64 },
            function(error, stdout, sterr) {
                if (!error) {
                    console.log("Switched to existing branch:", that.identifier);
                    callback(true);
                } else {
                    child_process.exec(
                        'cd ' + that.dest + ' && git checkout -b ' + that.identifier,
                        { maxBuffer: 1024 * 1024 * 64 },
                        function(error, stdout, sterr) {
                            if (!error) {
                                console.log("Switched to new branch:", that.identifier);
                                callback(true);
                            } else {
                                console.log(error);
                                callback(false);
                            }
                        }
                    );
                }
            }
        );
    }

    // Task type: merge branch
    mergeBranch = function(callback) {
        var that = this;
        child_process.exec(
            'cd ' + that.dest + ' && git checkout ' + that.identifier,
            { maxBuffer: 1024 * 1024 * 64 },
            function(error, stdout, sterr) {
                if (!error) {
                    child_process.exec(
                        'cd ' + that.dest + ' && git merge --no-ff ' + that.sourceIdentifier + ' -m "' + that.comment + '"',
                        { maxBuffer: 1024 * 1024 * 64 },
                        function(error, stdout, sterr) {
                            if (!error) {
                                console.log("Merged branch", that.sourceIdentifier, "into", that.identifier);
                                callback(true);
                            } else {
                                console.log(error);
                                callback(false);
                            }
                        }
                    );
                } else {
                    console.log(error);
                    callback(false);
                }
            }
        );
    }

    // Task type: close branch
    closeBranch = function(callback) {
        var that = this;
        child_process.exec(
            'cd ' + that.dest + ' && git branch -d ' + that.identifier,
            { maxBuffer: 1024 * 1024 * 64 },
            function(error, stdout, sterr) {
                if (!error) {
                    console.log("Deleted branch:", that.identifier);
                    callback(true);
                } else {
                    console.log(error);
                    callback(false);
                }
            }
        );
    }

    // Task type: tag commit
    tagCommit = function(callback) {
        var that = this;
        child_process.exec(
            'cd ' + that.dest + ' && git tag ' + that.identifier,
            { maxBuffer: 1024 * 1024 * 64 },
            function(error, stdout, sterr) {
                if (!error) {
                    console.log("Created tag:", that.identifier);
                    callback(true);
                } else {
                    console.log(error);
                    callback(false);
                }
            }
        );
    }

    // Returns a debug object for logging information
    debugObject = function() {
        return {
            type: this.type,
            identifier: this.identifier,
            comment: this.comment
        };
    }

}


// --
// Main patcher logic
// --

// Constructor
function AutoPatcher() {
}

// Recursively execute patch tasks
AutoPatcher.executeTasks = function(patchTasks, index, callback) {
    // Return when all tasks are done
    if (index >= patchTasks.length) {
        callback(true);
        return;
    }

    // Execute task
    patchTasks[index].apply(function(success) {
        if (success) {
            AutoPatcher.executeTasks(patchTasks, index + 1, callback);
        } else {
            callback(false);
        }
    });
}

// Start patching
AutoPatcher.applyPatches = function(source, dest, commitCollector, patchCommitNumberRange, callback) {
    // Set up task list
    var currentBranch = null;
    var tasks = [];
    for (var i = patchCommitNumberRange[0]; i <= patchCommitNumberRange[1]; i++) {
        // Search the branch the commit belongs to
        var branch = commitCollector.findBranchWithCommitNumber(i);
        if (branch == null) {
            console.log("Can't find branch for commit number:", i);
            callback(false);
            return;
        }

        // Look up the commit
        var commit = null;
        var branchCommitIndex = 0;
        for (var j = 0; j < branch.commits.length; j++) {
            if (branch.commits[j].number == i) {
                commit = branch.commits[j];
                branchCommitIndex = j;
                break;
            }
        }
        if (commit == null) {
            console.log("Can't find commit for number:", i);
            callback(false);
            return;
        }

        // Add a switch branch task if they are different (except the first commit, it's always master and doesn't need branch creation)
        if (branch !== currentBranch) {
            if (i > 0) {
                if (branch.sourceBranch != null && branch.sourceBranch !== currentBranch && branchCommitIndex == 0) {
                    tasks.push(new PatchTask(source, dest, "branch", branch.sourceBranch.name));
                }
                tasks.push(new PatchTask(source, dest, "branch", branch.name));
            }
            currentBranch = branch;
        }

        // Add a patch task if the commit is not a merge commit (they are handled differently)
        if (!commit.mergeCommit) {
            tasks.push(new PatchTask(source, dest, "patch", commit.hash, null, commit.comment));
        }

        // Add a tag task if the commit was tagged
        if (commit.tag) {
            tasks.push(new PatchTask(source, dest, "tag", commit.tag));
        }

        // Check for merges
        if (i < patchCommitNumberRange[1] && branch.merges[branchCommitIndex]) {
            var merges = branch.merges[branchCommitIndex];
            if (merges.length) {
                for (var j = 0; j < merges.length; j++) {
                    tasks.push(new PatchTask(source, dest, "merge", merges[j].branch.name, branch.name, merges[j].comment));
                }
                tasks.push(new PatchTask(source, dest, "branch", merges[merges.length - 1].branch.name));
                currentBranch = merges[merges.length - 1].branch;
            }
            if (branch.closed) {
                var foundHigherMerge = false;
                for (var key in branch.merges) {
                    if (key > branchCommitIndex) {
                        foundHigherMerge = true;
                    }
                }
                if (!foundHigherMerge) {
                    tasks.push(new PatchTask(source, dest, "close", branch.name));
                }
            }
        }
    }

    // Execute them
    AutoPatcher.executeTasks(tasks, 0, function(success) {
        callback(success);
    })
}

// Initialize a repository if needed
AutoPatcher.initRepositoryIfNeeded = function(dest, doInit, callback) {
    // Do nothing if no initialization has to be done
    if (!doInit) {
        callback(null);
        return;
    }

    // Continue
    child_process.exec(
        'cd ' + dest + ' && git init',
        { maxBuffer: 1024 * 1024 * 64 },
        function(error, stdout, sterr) {
            if (error) {
                console.log(error);
            } else {
                console.log("New repository created at:", dest);
            }
            callback(error);
        }
    )
}

// Check folder for a repository, optionally be able to create it
AutoPatcher.checkFolder = function(dest, canCreateFolder, callback) {
    fs.lstat(dest, function(error, stats) {
        if (!error && stats.isDirectory()) {
            child_process.exec(
                'cd ' + dest + ' && git status',
                { maxBuffer: 1024 * 1024 * 64 },
                function(error, stdout, sterr) {
                    callback(true, error ? false : true);
                }
            );
        } else if (canCreateFolder) {
            fs.mkdir(dest, { recursive: true }, function(error) {
                if (error) {
                    console.log(error);
                    callback(false, false);
                } else {
                    callback(true, false);
                }
            })
        } else {
            callback(false, false);
        }
    });
}

// Starter
AutoPatcher.start = function() {
    // Add/adjust config based on commandline parameters
    for (var i = 2; i < process.argv.length; i++) {
        var arg = process.argv[i];
        var argSplit = arg.split("=");
        if (argSplit.length > 1) {
            if (argSplit[1] == "true") {
                patcherConfig[argSplit[0]] = true;
            } else if (argSplit[1] == "false") {
                patcherConfig[argSplit[0]] = false;
            } else {
                patcherConfig[argSplit[0]] = argSplit[1];
            }
        }
    }

    // Scan commit log
    var source = patcherConfig["source"];
    if (source) {
        var commitCollector = new CommitCollector(source)
        commitCollector.gatherHistory(function(success) {
            if (success) {
                // Obtain range of commits to patch
                var patchCommitNumberRange = [];
                if (patcherConfig["branch"]) {
                    patchCommitNumberRange = commitCollector.getCommitNumbersForBranch(patcherConfig["branch"]);
                } else if (patcherConfig["commit"]) {
                    var commitNumber = commitCollector.getCommitNumberForHash(patcherConfig["commit"]);
                    if (patcherConfig["count"] && patcherConfig["count"] > 0) {
                        patchCommitNumberRange = [ commitNumber, commitNumber + patcherConfig["count"] - 1 ];
                    } else {
                        patchCommitNumberRange = [ commitNumber, commitNumber ];
                    }
                } else if (patcherConfig["startCommit"] && patcherConfig["endCommit"]) {
                    patchCommitNumberRange = commitCollector.getCommitNumbersForHashRange(patcherConfig["startCommit"], patcherConfig["endCommit"]);
                } else {
                    console.log("Found branches:\n" + commitCollector.branches.map(item => { return item.name }).join("\n") + "\n\nAutomatically patch with a commit hash range or one of the branches above.");
                    return;
                }

                // Continue with patching
                if (patchCommitNumberRange.length == 2 && patchCommitNumberRange[0] >= 0 && patchCommitNumberRange[1] >= 0) {
                    if (patcherConfig["dest"]) {
                        var dest = patcherConfig["dest"];
                        AutoPatcher.checkFolder(dest, patchCommitNumberRange[0] == 0, function(canContinue, hasRepository) {
                            if (canContinue) {
                                AutoPatcher.initRepositoryIfNeeded(dest, !hasRepository, function(error) {
                                    if (!error) {
                                        AutoPatcher.applyPatches(source, dest, commitCollector, patchCommitNumberRange, function(success) {
                                            if (success) {
                                                console.log("Done");
                                            }
                                        })
                                    }
                                })
                            }
                        });
                    } else {
                        console.log("Missing parameter in commandline (dest), given parameters:", patcherConfig);
                    }
                } else {
                    console.log("Could not find commits for the given branch or commit(s)");
                }
            }
        });
    } else {
        console.log("Missing parameter in commandline (source), given parameters:", patcherConfig);
    }
}

AutoPatcher.start()
