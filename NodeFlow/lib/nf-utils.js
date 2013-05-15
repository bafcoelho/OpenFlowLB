// Example OpenFlow Controller written for Node.js
// Prototype eventing system handling of OF messages
// 
// Copyright 2011-2012 (C) Cisco Systems, Inc.
// Author : Gary Berger, Cisco Systems, inc.
var util = require('util')
var oflib = require('../oflib-node');
var version = "1.0" // fix this!!
var ofpp = require('../oflib-node/lib/ofp-' + version + '/ofp.js')


module.exports = {

	setSyncmessage: function(type, obj) {
		return {
			message: {
				"header": {
					"type": type,
					"xid": obj.message.header.xid || 1 //don't care?
				},
				"version": 0x01,
				//TODO 
				"body": {}
			}
		}
	},


	sendPacket: function(type, obj, sessionID) {

		var typelower = type.toLowerCase()
		var bufsize = ofpp.h_sizes[typelower]
		var buf = new Buffer(bufsize);

		var pack = oflib.pack(obj, buf, 0)

		if (!('error' in pack)) {
			socket = sessions[sessionID].sessionSocket
			socket.write(buf)
		} else {
			util.log("_sendPacket Error packing object " + util.inspect(pack))
		}

	},
	fillBuffer: function(obj, buffer) {
		var pack = oflib.pack(obj, buffer, 0)
	},


	sendBuffer: function(buffer, sessionID) {

		socket = sessions[sessionID].sessionSocket
		socket.write(buffer)

	},


	do_l2_learning: function(obj, packet) {
		self = this

		var dl_src = packet.shost
		var dl_dst = packet.dhost
		var in_port = obj.message.body.in_port
		var dpid = obj.dpid

		if (dl_src == 'ff:ff:ff:ff:ff:ff') {
			util.log('Warning source set to Broadcast')
			return
		}

		if (!l2table.hasOwnProperty(dpid)) {
			l2table[dpid] = {} //create object
		}
		// if (l2table[dpid].hasOwnProperty(dl_src)) { //this is wrong
		debugger

		if (l2table[dpid].hasOwnProperty(dl_src)) {
			var dst = l2table[dpid][dl_src]
			if (dst != in_port) {
				util.log("MAC has moved from " + dst + " to " + in_port)
			} else {
				return
			}

		} else {
			if (debug) {
				util.log("learned mac " + dl_src + " port : " + in_port)
			}
			l2table[dpid][dl_src] = in_port

		}
		if (debug) {
			console.dir(l2table)
		}

	},

	setOutFloodPacket: function(obj, in_port) {
		return {

			message: {

				header: {
					type: 'OFPT_PACKET_OUT',
					xid: obj.message.header.xid
				},
				body: {
					buffer_id: obj.message.body.buffer_id,
					in_port: in_port,
					actions: [{
						header: {
							type: 'OFPAT_OUTPUT'
						},
						body: {
							port: 'OFPP_FLOOD'
						},
					}]
				},
				version: 0x01
			}
		}
	},


	extractFlow: function(packet) {

		var flow = {}

		flow.dl_src = packet.shost
		flow.dl_dst = packet.dhost
		flow.dl_type = packet.ethertype

		if (packet.hasOwnProperty('vlan')) {
			// TODO
			flow.dl_vlan = packet.vlan
			flow.dl_vlan_pcp = packet.priority
		} else {
			flow.dl_vlan = 0xffff
			flow.dl_vlan_pcp = 0
		}

		if (packet.hasOwnProperty('ip')) {
			flow.nw_src = packet.ip.saddr
			flow.nw_dst = packet.ip.daddr
			flow.nw_proto = packet.ip.protocol

			if (packet.ip.hasOwnProperty('udp' || 'tcp')) {
				flow.tp_src = packet.ip.saddr
				flow.tp_dst = packet.ip.daddr
			} else {
				if (packet.ip.hasOwnProperty('icmp')) {
					flow.tp_src = packet.ip.icmp.type
					flow.tp_dst = packet.ip.icmp.code
				} else {
					flow.tp_src = '0.0.0.0'
					flow.tp_dst = '0.0.0.0'
				}
			}
		} else {
			flow.nw_src = '0.0.0.0'
			flow.nw_dst = '0.0.0.0'
			flow.nw_proto = 0
			flow.tp_src = '0.0.0.0'
			flow.tp_dst = '0.0.0.0'


		}
		return flow
	},

	forward_l2_packet_enhanced : function(obj, packet, sessionID) {
		var self = this
		var dl_dst = packet.dhost
		var dl_src = packet.shost
		var dpid = obj.dpid
		var in_port = l2table[dpid][dl_src]
		var out_port = l2table[dpid][dl_dst]


		if (obj && (dl_dst != 'ff:ff:ff:ff:ff:ff') && l2table[dpid].hasOwnProperty(dl_dst)) {

			// //Build Flow Template
			// var flow_template = new Buffer(ofpp.h_sizes['ofpt_flow_mod']);
			// var n = nfutils.setFlowModPacket(obj, packet, in_port, out_port)
			// n.copy(flow_template,0,0,n.length)
			outputFlood = nfutils.setOutFloodPacket(obj, out_port)
			outputFlow = nfutils.setFlowModPacket(obj, packet, in_port, out_port)

			if (out_port == in_port) {
				util.log("*warning* learned port = " + in_port + ", system=nodeFlow")
				obj.outmessage = outputFlood

				self.emit('SENDPACKET', {
					"packet": obj,
					"type": 'OFPT_PACKET_OUT'
				})

				return

			}


			if (flowtable.hasOwnProperty(dpid)) {
				if (flowtable[dpid].hasOwnProperty(dl_dst)) {
					if (debug) {
						util.log('Re-useing Flow Table Buffer')
					}
					buffer = flowtable[dpid][dl_dst]
					nfutils.sendBuffer(buffer, obj.sessionID)
					return
				}

			} else {
				if (debug) {
					util.log(util.format("Installing flow for destination: %s source: %s  in_port: %s\tout_port: %s\tsystem=NodeFlow", dl_dst, dl_src, in_port, out_port))
				}
				// obj.outmessage = nfutils.setFlowModPacket(obj, packet, in_port, out_port)
				obj.outmessage = outputFlow
				var flow_template = new Buffer(ofpp.h_sizes['ofpt_flow_mod']);

				nfutils.fillBuffer(obj, flow_template)
				flowtable[dpid] = {}
				flowtable[dpid][dl_dst] = flow_template
			}
			console.dir(obj)
			self.emit('SENDPACKET', {
				"packet": obj,
				"type": 'OFPT_FLOW_MOD'
			})


		} else {
			if (debug) {
				util.log("Flooding Unknown Buffer id:" + obj.message.body.buffer_id)
			}
			obj.outmessage = nfutils.setOutFloodPacket(obj, in_port)
			self.emit('SENDPACKET', {
				"packet": obj,
				"type": 'OFPT_PACKET_OUT'
			})

		}
	},


	setFlowModPacket: function(obj, packet, in_port, out_port) {

		var dl_dst = packet.dhost
		var dl_src = packet.shost

		var flow = self.extractFlow(packet)

		flow.in_port = in_port

		return {
			message: {
				version: 0x01,
				header: {
					type: 'OFPT_FLOW_MOD',
					xid: obj.message.header.xid
				},
				body: {
					command: 'OFPFC_ADD',
					hard_timeout: 0,
					idle_timeout: 100,
					priority: 0x8000,
					buffer_id: obj.message.body.buffer_id,
					out_port: 'OFPP_NONE',
					flags: ['OFPFF_SEND_FLOW_REM'],
					match: {
						header: {
							type: 'OFPMT_STANDARD'
						},
						body: {
							'wildcards': 0,
							"in_port": flow.in_port,
							"dl_src": flow.dl_src,
							'dl_dst': flow.dl_dst,
							'dl_vlan': flow.dl_vlan,
							'dl_vlan_pcp': flow.dl_vlan_pcp,
							'dl_type': flow.dl_type,
							'nw_proto': flow.nw_proto,
							'nw_src': flow.nw_src,
							'nw_dst': flow.nw_dst,
							'tp_src': flow.tp_src,
							'tp_dst': flow.tp_dst,
						},
					},
					actions: {
						header: {
							type: 'OFPAT_OUTPUT'
						},
						body: {
							port: out_port
						}
					}

				}
			}


		}
	}


}