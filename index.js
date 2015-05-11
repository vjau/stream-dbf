var stream = require('stream'),
    fs = require('fs'),
    util = require('util'),
    events = require('events');

var Parser = function(fileName, options) {
  var self = this;
  this.fileName   = fileName;
  this.header     = this.getHeader();
  this.fieldsCnt  = this.header.fields.length;
  this.parseTypes = true;

  if (options) {
    if ( options.parseTypes != undefined )
      this.parseTypes = options.parseTypes;
  }

  var hNumRecs  = this.header.numberOfRecords
    , hRecLen   = this.header.recordLength
    , hDataSize = hNumRecs * hRecLen;

  var seqNumber  = 0
    , skipBytes  = this.header.headerLength
    , byteReades = 0
    , buffer     = new Buffer(0);

  this.stream = new stream.Transform({ 'objectMode': true });
  this.stream._transform = function( chunk, encoding, done ) {
    var buffPos = 0
      , buffLen = 0
      , rec;
    buffer  = Buffer.concat([ buffer, chunk ]);
    buffLen = buffer.length;
    
    if ( skipBytes ) {
      if( skipBytes >= buffLen ) {
        skipBytes = skipBytes - buffLen;
        done();
        return;
      }
      buffPos   = skipBytes;
      skipBytes = 0;
    }
    
    while ( byteReades<hDataSize && (buffPos+hRecLen)<=buffLen ) {
      rec = self.parseRecord(
              ++seqNumber,
              buffer.slice( buffPos, buffPos+hRecLen )
      );
      buffPos += hRecLen;
      byteReades += hRecLen;
      this.push( rec );
    }
    
    buffer = buffer.slice( buffPos, buffLen );
    done();
  };

  fs.createReadStream(this.fileName).pipe(this.stream);
};

util.inherits(Parser, events.EventEmitter);

Parser.prototype.parseRecord = function(sequenceNumber, buffer) {
  var self = this;

  var record = {
    '@sequenceNumber': sequenceNumber,
    '@deleted'       : buffer[0] !== 32
  };
  for ( var i=0, pos=1, fld; i < this.fieldsCnt; i++ ) {
    fld = this.header.fields[i];
    record[fld.name] = self.parseField( fld, buffer.slice(pos, pos+fld.length) );
    pos += fld.length;
  }
  return record;
};

Parser.prototype.parseField = function(field, buffer) {
  var st  = 0
    , end = buffer.length;
  while( end>st && buffer[end-1]===32 ) end--;
  while( st<end && buffer[st   ]===32 ) st++;
  
  if( field.raw ) {
        return buffer.slice( st, end );
  }

  var data = buffer.toString( 'utf-8', st, end );
  if ( this.parseTypes ) {
    if ( field.type==='N' || field.type==='F' ) {
      data = Number( data );
    }
  }

  return data;
};


Parser.prototype.getHeader = function() {
  var fd = fs.openSync( this.fileName, 'r' )
    , buff = new Buffer( 32 )
    , header;
  fs.readSync( fd, buff, 0, 32, 0 );
  header = this.parseBaseHeader( buff );
  buff = new Buffer( header.headerLength );
  fs.readSync( fd, buff, 0, header.headerLength, 0 );
  this.parseFieldsHeader( header, buff );
  fs.closeSync( fd );
  return header;
};

Parser.prototype.parseBaseHeader = function(data) {
  var header = {
    'version'        : data.readUInt8  (  0, true ),
    'dateUpdated'    : this.parseHeaderDate( data.slice(1, 4) ),
    'numberOfRecords': data.readInt32LE(  4, true ),
    'headerLength'   : data.readInt16LE(  8, true ),
    'recordLength'   : data.readInt16LE( 10, true ),
    'fields'         : []
  };
  return header;
};

Parser.prototype.parseFieldsHeader = function(header, data) {
  var fieldData = [];
  for (var i = 32; i <= header.headerLength-32; i += 32) {
    fieldData.push( data.slice(i, i + 32) );
  }

  header.fields = fieldData.map(this.parseFieldSubRecord);
};

Parser.prototype.parseHeaderDate = function(buffer) {
  var day   = buffer.readUInt8( 0, true ) + 1900
    , month = buffer.readUInt8( 1, true ) - 1
    , year  = buffer.readUInt8( 2, true );
  return new Date( year, month, day );
};

Parser.prototype.parseFieldSubRecord = function(buffer) {
  var field = {
    'name'         : buffer.toString( 'utf-8',  0, 11 ).replace( /\x00+$/, '' ),
    'type'         : buffer.toString( 'utf-8', 11, 12 ),
    'displacement' : buffer.readInt32LE( 12, true ),
    'length'       : buffer.readUInt8( 16, true ),
    'decimalPlaces': buffer.readUInt8( 17, true ),
    'indexFlag'    : buffer.readUInt8( 31, true )
  };
  return field;
};

module.exports = Parser;
