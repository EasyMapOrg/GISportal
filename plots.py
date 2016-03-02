#! /usr/bin/env python

"""
$Id$
Library to make a variety of plots.
Uses bokeh as the plotting engine.

Available functions
listPlots: Return a list of available plot types.
"""

from __future__ import print_function
import __builtin__
import sys
import requests
import urllib2

import numpy as np
import pandas as pd
import json
import jinja2
import urllib
import os, hashlib
import time
import zipfile
import shutil

from bokeh.plotting import figure, save, show, output_notebook, output_file, ColumnDataSource, hplot, vplot
from bokeh.models import LinearColorMapper, NumeralTickFormatter,LinearAxis, Range1d, HoverTool, CrosshairTool
from bokeh.resources import CSSResources
from bokeh.embed import components

import palettes

from data_extractor.extractors import BasicExtractor, IrregularExtractor, TransectExtractor, SingleExtractor
from data_extractor.extraction_utils import Debug, get_transect_bounds, get_transect_times
from data_extractor.analysis_types import BasicStats, TransectStats, HovmollerStats


# Set the default logging verbosity to lowest.
verbosity = 0



template = jinja2.Template("""
<!DOCTYPE html>
<html lang="en-US">

<link
    href="http://cdn.pydata.org/bokeh/release/bokeh-0.11.0.css"
    rel="stylesheet" type="text/css"
>
<script 
    src="http://cdn.pydata.org/bokeh/release/bokeh-0.11.0.js"
></script>

<body>
<h1>TEST</h1>
<div id="plot">
    {{ script }}
    
    {{ div }}
</div>
</body>

</html>
""")

hovmoller_template = jinja2.Template("""
<!DOCTYPE html>
<html lang="en-US">

<link
    href="http://cdn.pydata.org/bokeh/release/bokeh-0.11.0.css"
    rel="stylesheet" type="text/css"
>
<script 
    src="http://cdn.pydata.org/bokeh/release/bokeh-0.11.0.js"
></script>

<body>
<h1>TEST</h1>
{{ script }}
    {{ div }}

</body>

</html>
""")



# Just pick some random colours. Probably need to make this configurable.
plot_palette = [['#7570B3', 'blue', 'red', 'red'], ['#A0A0A0', 'green', 'orange', 'orange']]

# Home rolled enums as Python 2.7 does not have them.
class Enum(set):
    def __getattr__(self, name):
        if name in self:
            return name
        raise AttributeError

# Valid plot status values.
Plot_status = Enum(["initialising", "extracting", "plotting", "complete", "failed"])

def get_palette(palette="rsg_colour"):
   colours = []
   my_palette = palettes.getPalette('rsg_colour')
   
   for i in range(0, len(my_palette), 4):
       colours.append("#{:02x}{:02x}{:02x}".format(my_palette[i], my_palette[i+1], my_palette[i+2]))

   return(colours)
#END get_palette

def datetime(x):
   return np.array(pd.to_datetime(x).astype(np.int64) // 10**6)
   #return np.array(x, dtype=np.datetime64)
#END datetime

def hovmoller_legend(min_val, max_val, colours, var_name, plot_units, log_plot):   
   '''
   Returns a bokeh plot with a legend based on the colours provided.

   Here we calculate the slope and intercept from the min and max
   and use that to build an array of colours for the legend.
   We also have to set the height of each block individually to match the scale 
   (particularly for log scales) otherwise we get ugly gaps.
   NOTE - We work in the display scale (log or otherwise) but the values for the axis 
   are calculated in real space regardless.
   '''
   slope = (max_val - min_val) / (len(colours) - 1)
   intercept = min_val 

   legend_values = []
   legend_heights = []
   if log_plot:
      for i in range(len(colours)):
         legend_values.append(np.power(10,(slope * i) + intercept))
         legend_heights.append(legend_values[i] - legend_values[i-1])
   else:
      for i in range(len(colours)):
         legend_values.append((slope * i) + intercept)
         legend_heights.append(legend_values[i] - legend_values[i-1])
   
   legend_source = ColumnDataSource(data=dict(value=legend_values, 
                                              color=colours, 
                                              heights=legend_heights))
   
   if log_plot:
      # Remember to use the actual values not the logs for the y range
      legend_y_range=(np.power(10, min_val), np.power(10, max_val))
      legend_y_axis_type="log"
   else:
      legend_y_range=(min_val, max_val)
      legend_y_axis_type="linear"
   
   legend = figure(width=150, y_axis_type=legend_y_axis_type, y_range=legend_y_range)
                   
   # Set the y axis format so it does not default to scientific notation.
   legend.yaxis[0].formatter = NumeralTickFormatter(format="0.00")
   legend.yaxis.axis_label = "{} {}".format(var_name, plot_units)

   legend.xaxis.visible = False
   
   legend.toolbar_location=None
   
   legend.rect(dilate = True, x=0.5, y='value', fill_color='color', 
               line_color='color', height='heights', width=1,  
               source=legend_source)

   return(legend)
#END hovmoller_legend   
   
def hovmoller(plot, outfile="image.html"):
       
   plot_type = plot['type']
   plot_title = plot['title']
   plot_units = plot['y1Axis']['label']

   my_hash = plot['req_hash']
   my_id = plot['req_id']
   dir_name = plot['dir_name']

   df = plot['data'][0]
   plot_type = df['type']
   var_name = df['coverage']
   plot_scale = df['scale']

   varindex = {j: i for i, j in enumerate(df['vars'])}

   assert plot_type in ("hovmollerLat", "hovmollerLon")
   
   data = np.transpose(df['data'])

   # Save the CSV files
   csv_dir = dir_name + "/" + my_hash

   try:
      os.mkdir(csv_dir)
   except OSError as err:
      if err.errno == 17: #[Errno 17] File exists:
         pass
      else:
         raise

   csv_file = csv_dir + "/" + df['coverage'] + ".csv"
   np.savetxt(csv_file, np.transpose(data), comments='', header=','.join(df['vars']), fmt="%s",delimiter=",")

   with zipfile.ZipFile(csv_dir+".zip", mode='w') as zf:
      zf.write(csv_file)

   shutil.rmtree(csv_dir)

   # Format date to integer values
   #date = np.array(pd.to_datetime(df['Date']).astype(np.int64) // 10**6)
   date = datetime(data[varindex['date']])
   
   # Format latlon to float. Otherwise we can not do the mins etc.
   #latlon = np.array(df["LatLon"]).astype(np.float)
   latlon = np.array(data[varindex['latlon']]).astype(np.float64)
   
   # Guess the size of each axis from the number of unique values in it.
   x_size = len(set(date))
   y_size = len(set(latlon))

   # Make our array of values the right shape.
   # If the data list does not match the x and y sizes then bomb out.
   assert x_size * y_size == len(data[varindex['value']])
   
   # We want a 2d array with latlon as x axis and date as y.
   values = np.reshape(np.array(data[varindex['value']]),(-1,y_size))

   # Easiest if we force float here but is that always true?
   # We also have problems with how the data gets stored as JSON (very big!).
   values = values.astype(np.float64)
   
   if plot_scale == "log":
       log_plot = True
       values = np.log10(values)
   else:
       log_plot = False
       
   # If it has got this far without breaking the array must be regular (all rows same length) so
   # the next date value will be y_size elements along the array.
   date_step = date[y_size] - date[0]
   
   # Arrange the x and y's to suit the plot.
   if plot_type == 'hovmollerLat':
       # Swap the values around so that the date is on the x axis
       values = np.transpose(values)
       x_size, y_size = y_size, x_size

       # I think the coords refer to pixel centres so scale by half a pixel.
       min_x = date[0] - date_step / 2
       max_x = date[-1] + date_step / 2
       min_y = latlon[0] - (latlon[1] - latlon[0]) / 2
       max_y = latlon[-1] + (latlon[1] - latlon[0]) / 2
       x_axis_type = "datetime"
       y_axis_type = plot_scale
       x_axis_label = "Date"
       y_axis_label = "Latitude"
   else:
       # I think the coords refer to pixel centres so scale by half a pixel.
       min_x = latlon[0] - (latlon[1] - latlon[0]) / 2
       max_x = latlon[-1] + (latlon[1] - latlon[0]) / 2
       min_y = date[0] - date_step / 2
       max_y = date[-1] + date_step / 2
       x_axis_type = plot_scale
       y_axis_type = "datetime"
       x_axis_label = "Longitude"
       y_axis_label = "Date"
 
   # We are working in the plotting space here, log or linear. Use this to set our
   # default scales.
   min_val = np.amin(values)
   max_val = np.amax(values)

   colours = get_palette()
   legend = hovmoller_legend(min_val, max_val, colours, var_name, plot_units, log_plot)

   # Create an RGBA array to show the Hovmoller. We do this rather than using the Bokeh image glyph
   # as that passes the actual data into bokeh.js as float resulting in huge files.   
   
   # First create an empty array of 32 bit ints.
   img = np.empty((x_size, y_size), dtype=np.uint32)

   # Create a view of the same array as an array of RGBA values.
   view = img.view(dtype=np.uint8).reshape((x_size, y_size, 4))

   # We are going to set the RGBA based on our chosen palette. The RSG library returns a flat list of values.
   my_palette = palettes.getPalette('rsg_colour')
   slope = (max_val - min_val) / (len(colours) - 1)
   intercept = min_val
   for i in range(x_size):
      for j in range(y_size):
        p_index = int((values[i,j] - intercept) / slope) * 4
        view[i, j, 0] = my_palette[p_index]
        view[i, j, 1] = my_palette[p_index+1]
        view[i, j, 2] = my_palette[p_index+2]
        view[i, j, 3] = 255

   plot_width = 800
   p = figure(width=plot_width, x_range=(min_x, max_x), y_range=(min_y, max_y), 
              x_axis_type=x_axis_type, y_axis_type=y_axis_type, 
              title="Hovmoller - {}".format(plot_title), responsive=True)

   p.xaxis.axis_label = x_axis_label
   p.yaxis.axis_label = y_axis_label
   
   # Create an RGBA image anchored at (min_x, min_y).
   p.image_rgba(image=[img], x=[min_x], y=[min_y], dw=[max_x-min_x], dh=[max_y-min_y])
   
   p.add_tools(CrosshairTool())

   #TODO This should be in the wrapper
   script, div = components({'hovmoller':p, 'legend': legend})
   #with open(outfile, 'w') as output_file:
      #print(hovmoller_template.render(script=script, div=div), file=output_file)
   
   output_file(outfile, title="Hovmoller example")
   layout = hplot(legend, p)
   save(layout)
   return(p)
#END hovmoller

def transect(plot, outfile="transect.html"):

   plot_data = plot['data']
   plot_type = plot['type']
   plot_title = plot['title']
 
   my_hash = plot['req_hash']
   my_id = plot['req_id']
   dir_name = plot['dir_name']

   sources = []

   ymin = []
   ymax = []

   csv_dir = dir_name + "/" + my_hash

   try:
      os.mkdir(csv_dir)
   except OSError as err:
      if err.errno == 17: #[Errno 17] File exists:
         pass
      else:
         raise

   zf = zipfile.ZipFile(csv_dir+".zip", mode='w')

   for df in plot_data:
          
      # Build the numerical indices into our data based on the variable list supplied.
      varindex = {j: i for i, j in enumerate(df['vars'])}

      plot_scale= df['scale']

      debug(4, "timeseries: varindex = {}".format(varindex))

      # Grab the data as a numpy array.
      dfarray = np.array(df['data'])
      dfarray[dfarray == 'null'] = "NaN"

      debug(4, dfarray)

      # Flip it so we have columns for each variable ordered by time.
      data = np.transpose(dfarray[np.argsort(dfarray[:,2])])

      debug(4,data)
      # Write out the CSV of the data.
      # TODO Should we put this in a function
 
      csv_file = csv_dir + "/" + df['coverage'] + ".csv"
      np.savetxt(csv_file, np.transpose(data), comments='', header=','.join(df['vars']), fmt="%s",delimiter=",")
      zf.write(csv_file)

      min_value = np.amin(data[varindex['data_value']].astype(np.float64))
      max_value = np.amax(data[varindex['data_value']].astype(np.float64))
      buffer_value = (max_value - min_value) /20
      ymin.append(min_value-buffer_value)
      ymax.append(max_value+buffer_value)
      date = datetime(data[varindex['track_date']])
      
      datasource = dict(date=date,
                        sdate=data[varindex['track_date']],
                        lat=data[varindex['track_lat']],
                        lon=data[varindex['track_lon']],
                        value=data[varindex['data_value']])

      sources.append(ColumnDataSource(data=datasource))
      
   zf.close()
   shutil.rmtree(csv_dir)

   ts_plot = figure(title=plot_title, x_axis_type="datetime", y_axis_type = plot_scale, width=1200, 
              height=400, responsive=True
   )
   
   tooltips = [("Date", "@sdate")]
   tooltips.append(("Value", "@value"))
   tooltips.append(("Latitude", "@lat"))
   tooltips.append(("Longitude", "@lon"))

   ts_plot.add_tools(CrosshairTool())

   ts_plot.xaxis.axis_label = 'Date'
   
   # Set up the axis label here as it writes to all y axes so overwrites the right hand one
   # if we run it later.
   debug(2,"timeseries: y1Axis = {}".format(plot['y1Axis']['label']))
   ts_plot.yaxis[0].formatter = NumeralTickFormatter(format="0.00")
   ts_plot.yaxis.axis_label = plot['y1Axis']['label']
   ts_plot.y_range = Range1d(start=ymin[0], end=ymax[0])
   yrange = [None, None]

   for i, source in enumerate(sources):
      # If we want 2 Y axes then the lines below do this
      if plot_data[i]['yaxis'] == 2 and len(ymin) > 1 and 'y2Axis' in plot.keys(): 
         debug(2, "Plotting y2Axis, {}".format(plot['y2Axis']['label']))
         # Setting the second y axis range name and range
         yrange[1] = "y2"
         ts_plot.extra_y_ranges = {yrange[1]: Range1d(start=ymin[1], end=ymax[1])}
   
         # Adding the second axis to the plot.  
         ts_plot.add_layout(LinearAxis(y_range_name=yrange[1], axis_label=plot['y2Axis']['label']), 'right')
   
      y_range_name = yrange[plot_data[i]['yaxis'] - 1]
      # Plot the mean as line
      debug(2, "Plotting line for {}".format(plot_data[i]['coverage']))
      ts_plot.line('date', 'value', y_range_name=y_range_name, color=plot_palette[i][1], legend='Value {}'.format(plot_data[i]['coverage']), source=source)

      # as a point
      debug(2, "Plotting points for {}".format(plot_data[i]['coverage']))
      ts_plot.circle('date', 'value', y_range_name=y_range_name, color=plot_palette[i][2], size=5, alpha=0.5, line_alpha=0, source=source)
      
   hover = HoverTool(tooltips=tooltips)
   ts_plot.add_tools(hover)

   # Legend placement needs to be after the first glyph set up.
   # Cannot place legend outside plot.
   ts_plot.legend.location = "top_left"
   
   script, div = components(ts_plot)

   # plot the points
   #output_file(outfile, 'Time Series')
   with open(outfile, 'w') as output_file:
      print(template.render(script=script, div=div), file=output_file)
   
   #save(ts_plot)
   return(ts_plot)
#END transect
   
def timeseries(plot, outfile="time.html"):

   plot_data = plot['data']
   plot_type = plot['type']
   plot_title = plot['title']
 
   my_hash = plot['req_hash']
   my_id = plot['req_id']
   dir_name = plot['dir_name']

   sources = []

   ymin = []
   ymax = []

   csv_dir = dir_name + "/" + my_hash

   try:
      os.mkdir(csv_dir)
   except OSError as err:
      if err.errno == 17: #[Errno 17] File exists:
         pass
      else:
         raise

   zf = zipfile.ZipFile(csv_dir+".zip", mode='w')

   for df in plot_data:
          
      # Build the numerical indices into our data based on the variable list supplied.
      varindex = {j: i for i, j in enumerate(df['vars'])}

      plot_scale= df['scale']

      debug(4, "timeseries: varindex = {}".format(varindex))

      # Grab the data as a numpy array.
      dfarray = np.array(df['data'])
      debug(4, dfarray)

      # Flip it so we have columns for each variable ordered by time.
      data = np.transpose(dfarray[np.argsort(dfarray[:,0])])

      # Write out the CSV of the data.
      # TODO Should we put this in a function
 
      csv_file = csv_dir + "/" + df['coverage'] + ".csv"
      np.savetxt(csv_file, np.transpose(data), comments='', header=','.join(df['vars']), fmt="%s",delimiter=",")
      zf.write(csv_file)

      debug(4, data[varindex['mean']]) 
      ymin.append(np.amin(data[varindex['mean']].astype(np.float64)))
      ymax.append(np.amax(data[varindex['mean']].astype(np.float64)))
      date = datetime(data[varindex['date']])
      
      datasource = dict(date=date,
                        sdate=data[varindex['date']],
                        mean=data[varindex['mean']])

      if 'std' in df['vars']:
         # Set the errorbars
         err_xs = []
         err_ys = []
         for x, y, std in zip(date, data[varindex['mean']].astype(np.float64), data[varindex['std']].astype(np.float64)):
            if plot_scale == "linear":
               err_xs.append((x, x))
               err_ys.append((y - std, y + std))
            else:
               # Calculate the errors in log space. Not sure if this is what is wanted but the other looks silly.
               err_xs.append((x, x))
               err_ys.append((np.power(10, np.log10(y) - np.log10(std)), np.power(10, np.log10(y) + np.log10(std)))) 

         datasource['err_xs'] = err_xs
         datasource['err_ys'] = err_ys
         datasource['stderr'] = data[varindex['std']]
      
      if 'max' in df['vars'] and 'min' in df['vars']:
         # Set the min/max envelope. 
         # We create a list of coords starting with the max for the first date then join up all
         # the maxes in date order before moving down to the min for the last date and coming
         # back to the first date.
         band_y = np.append(data[varindex['max']].astype(np.float64),data[varindex['min']].astype(np.float64)[::-1])
         band_x = np.append(date,date[::-1])
         datasource['min'] = data[varindex['min']]
         datasource['max'] = data[varindex['max']]

      sources.append(ColumnDataSource(data=datasource))
      
   zf.close()
   shutil.rmtree(csv_dir)

   ts_plot = figure(title=plot_title, x_axis_type="datetime", y_axis_type = plot_scale, width=1200, 
              height=400, responsive=True
   )
   
   tooltips = [("Date", "@sdate")]
   tooltips.append(("Mean", "@mean"))
   tooltips.append(("Max ", "@max"))
   tooltips.append(("Min ", "@min"))
   tooltips.append(("Std ", "@stderr"))

   ts_plot.add_tools(CrosshairTool())

   ts_plot.xaxis.axis_label = 'Date'
   
   # Set up the axis label here as it writes to all y axes so overwrites the right hand one
   # if we run it later.
   debug(2,"timeseries: y1Axis = {}".format(plot['y1Axis']['label']))
   ts_plot.yaxis[0].formatter = NumeralTickFormatter(format="0.00")
   ts_plot.yaxis.axis_label = plot['y1Axis']['label']
   #ts_plot.extra_y_ranges = {"y1": Range1d(start=ymin[0], end=ymax[0])}
   ts_plot.y_range = Range1d(start=ymin[0], end=ymax[0])
   yrange = [None, None]

   # Adding the second axis to the plot.  
   #ts_plot.add_layout(LinearAxis(y_range_name="y1", axis_label=plot['y1Axis']['label']), 'left')
   
   for i, source in enumerate(sources):
      # If we want 2 Y axes then the lines below do this
      if plot_data[i]['yaxis'] == 2 and len(ymin) > 1 and 'y2Axis' in plot.keys(): 
         debug(2, "Plotting y2Axis, {}".format(plot['y2Axis']['label']))
         # Setting the second y axis range name and range
         yrange[1] = "y2"
         ts_plot.extra_y_ranges = {yrange[1]: Range1d(start=ymin[1], end=ymax[1])}
   
         # Adding the second axis to the plot.  
         ts_plot.add_layout(LinearAxis(y_range_name=yrange[1], axis_label=plot['y2Axis']['label']), 'right')
   
      if 'min' in datasource and len(sources) == 1:
         debug(2, "Plotting min/max for {}".format(plot_data[i]['coverage']))
         # Plot the max and min as a shaded band.
         # Cannot use this dataframe because we have twice as many band variables as the rest of the 
         # dataframe.
         # So use this.
         ts_plot.patch(band_x, band_y, color=plot_palette[i][0], fill_alpha=0.05, line_alpha=0)
      
      
      y_range_name = yrange[plot_data[i]['yaxis'] - 1]
      # Plot the mean as line
      debug(2, "Plotting mean line for {}".format(plot_data[i]['coverage']))
      ts_plot.line('date', 'mean', y_range_name=y_range_name, color=plot_palette[i][1], legend='Mean {}'.format(plot_data[i]['coverage']), source=source)

      # as a point
      debug(2, "Plotting mean points for {}".format(plot_data[i]['coverage']))
      ts_plot.circle('date', 'mean', y_range_name=y_range_name, color=plot_palette[i][2], size=5, alpha=0.5, line_alpha=0, source=source)
      
      if 'err_xs' in datasource:
         # Plot error bars
         debug(2, "Plotting error bars for {}".format(plot_data[i]['coverage']))
         ts_plot.multi_line('err_xs', 'err_ys', y_range_name=y_range_name, color=plot_palette[i][3], line_alpha=0.5, source=source)
      
   hover = HoverTool(tooltips=tooltips)
   ts_plot.add_tools(hover)

   # Legend placement needs to be after the first glyph set up.
   # Cannot place legend outside plot.
   ts_plot.legend.location = "top_left"
   
   script, div = components(ts_plot)

   # plot the points
   #output_file(outfile, 'Time Series')
   with open(outfile, 'w') as output_file:
      print(template.render(script=script, div=div), file=output_file)
   
   #save(ts_plot)
   return(ts_plot)
#END timeseries   

def scatter(plot, outfile='/tmp/scatter.html'):

   plot_data = plot['data']
   plot_type = plot['type']
   plot_title = plot['title']

   my_hash = plot['req_hash']
   my_id = plot['req_id']
   dir_name = plot['dir_name']


   # We have 2 sets of values we want to plot as a scatter. I think the extracter will bring these back together 
   # in the future.
   df1 = plot_data[0]
   df2 = plot_data[1]
          
   # Create a dict to hold index into the array for each item
   varindex = {j: i for i, j in enumerate(df1['vars'])}
   dfarray1 = np.array(df1['data'])
   data1 = np.transpose(dfarray1[np.argsort(dfarray1[:,0])])
      
   date = datetime(data1[varindex['date']])

   dfarray2 = np.array(df2['data'])
   data2 = np.transpose(dfarray2[np.argsort(dfarray2[:,0])])
      
   csv_dir = dir_name + "/" + my_hash

   try:
      os.mkdir(csv_dir)
   except OSError as err:
      if err.errno == 17: #[Errno 17] File exists:
         pass
      else:
         raise

   csv_file1 = csv_dir + "/" + df1['coverage'] + ".csv"
   np.savetxt(csv_file1, np.transpose(data1), comments='', header=','.join(df1['vars']), fmt="%s",delimiter=",")
   csv_file2 = csv_dir + "/" + df2['coverage'] + ".csv"
   np.savetxt(csv_file2, np.transpose(data2), comments='', header=','.join(df2['vars']), fmt="%s",delimiter=",")
   with zipfile.ZipFile(csv_dir+".zip", mode='w') as zf:
      zf.write(csv_file1, arcname=df1['coverage'] + ".csv")
      zf.write(csv_file2, arcname=df2['coverage'] + ".csv")
      debug(3, "ZIP: {}".format(zf.namelist()))

   shutil.rmtree(csv_dir)

   datasource = dict(date=date,
                     sdate=data1[varindex['date']],
                     x=data1[varindex['mean']],
                     y=data2[varindex['mean']])

   source = ColumnDataSource(data=datasource)
      
   scatter_plot = figure(
      title=plot_title, 
      x_axis_type=plot['xAxis']['scale'], 
      y_axis_type=plot['y1Axis']['scale'], 
      width=800,
      height=300,
      responsive=True)

   hover = HoverTool(
      tooltips=[
         ("Date", "@sdate"),
         (df1['coverage'], "@x"),
         (df2['coverage'], "@y")
      ]
   )

   scatter_plot.add_tools(hover)

   scatter_plot.xaxis.axis_label = plot['xAxis']['label']
   
   # Set up the axis label here as it writes to all y axes so overwrites the right hand one
   # if we run it later.
   scatter_plot.yaxis.axis_label = plot['y1Axis']['label']
   
   scatter_plot.circle('x', 'y', color=plot_palette[0][2], size=10, fill_alpha=.5, line_alpha=0, source=source)
      
   # Legend placement needs to be after the first glyph set up.
   # Cannot place legend outside plot.
   scatter_plot.legend.location = "top_left"
   
   # plot the points
   output_file(outfile, 'Scatter Plot')
   
   save(scatter_plot)
   return(scatter_plot)
#END scatter


def get_plot_data(json_request, plot=dict()):
   debug(2, "get_plot_data: Started")

   # Common data for all plots. 
   series = json_request['plot']['data']['series']
   plot_type = json_request['plot']['type']
   plot_title = json_request['plot']['title']
   scale = json_request['plot']['y1Axis']['scale']
   units = json_request['plot']['y1Axis']['label']
   y1Axis = json_request['plot']['y1Axis']
   xAxis = json_request['plot']['xAxis']
   dirname = plot['dir_name']
   my_hash = plot['req_hash']

   # We will hold the actual data extracted in plot_data. We may get multiple returns so hold it
   # as a list.
   plot_data = []

   plot['type'] = plot_type
   plot['title'] = plot_title
   plot['xAxis'] = xAxis
   plot['y1Axis'] = y1Axis
   plot['data'] = plot_data
   debug(3, plot)

   # Only try and set the 2nd Y axis if we have info. in the request.
   if 'y2Axis' in json_request['plot'].keys(): 
      y2Axis = json_request['plot']['y2Axis']
      plot['y2Axis']=y2Axis

   update_status(dirname, my_hash, Plot_status.extracting, percentage=5)

   if plot_type in ("hovmollerLat", "hovmollerLon"):
      # Extract the description of the data required from the request.
      # Hovmoller should only have one data series to plot.
      if len(series) > 1:
         debug(0, "Error: Attempting to plot {} data series".format(len(series)))

      ds = series[0]['data_source']
      coverage = ds['coverage']
      time_bounds = urllib.quote_plus(ds['t_bounds'][0] + "/" + ds['t_bounds'][1])
      debug(3,"Time bounds: {}".format(time_bounds))

      coverage = ds['coverage']
      wcs_url = ds['threddsUrl']
      bbox = ["{}".format(ds['bbox'])]
      bbox = ds['bbox']
      time_bounds = [ds['t_bounds'][0] + "/" + ds['t_bounds'][1]]

      debug(3, "Requesting data: BasicExtractor('{}',{},extract_area={},extract_variable={})".format(ds['threddsUrl'], time_bounds, bbox, coverage))
      try:
         extractor = BasicExtractor(ds['threddsUrl'], time_bounds, extract_area=bbox, extract_variable=coverage)
         extract = extractor.getData()
         if plot_type == "hovmollerLat":
            hov_stats = HovmollerStats(extract, "Time", "Lat", coverage)
         else:
            hov_stats = HovmollerStats(extract, "Lon",  "Time", coverage)
         
         response = json.loads(hov_stats.process())
      except ValueError:
         debug(2, "Data request, {}, failed".format(data_request))
         return plot
         
      # TODO - Old style extractor response. So pull the data out.
      data = response['data']

      # And convert it to a nice simple dict the plotter understands.
      plot_data.append(dict(scale=scale, coverage=coverage, type=plot_type, units=units, title=plot_title,
                      vars=['date', 'latlon', 'value'], data=data))
      update_status(dirname, my_hash, Plot_status.extracting, percentage=90)

   elif plot_type in ("timeseries", "scatter"):
      #TODO Can have more than 1 series so need a loop.
      for s in series:
         ds = s['data_source']
         yaxis = s['yAxis']
         if yaxis == 1:
            scale = json_request['plot']['y1Axis']['scale']
         else:
            scale = json_request['plot']['y2Axis']['scale']

         coverage = ds['coverage']
         wcs_url = ds['threddsUrl']
         bbox = ds['bbox']
         time_bounds = [ds['t_bounds'][0] + "/" + ds['t_bounds'][1]]

         data_request = "BasicExtractor('{}',{},extract_area={},extract_variable={})".format(ds['threddsUrl'], time_bounds, bbox, coverage)
         debug(3, "Requesting data: {}".format(data_request))
         try:
            extractor = BasicExtractor(ds['threddsUrl'], time_bounds, extract_area=bbox, extract_variable=coverage)
            extract = extractor.getData()
            ts_stats = BasicStats(extract, coverage)
            response = json.loads(ts_stats.process())
         except ValueError:
            debug(2, "Data request, {}, failed".format(data_request))
            return dict(data=[])
         #except urllib2.HTTPError:
            #debug(2, "Data request, {}, failed".format(data_request))
            #return dict(data=[])
         except requests.exceptions.ReadTimeout:
            debug(2, "Data request, {}, failed".format(data_request))
            return dict(data=[])
         
         debug(4, "Response: {}".format(response))

         #TODO LEGACY - this reformats the response to the new format.
         data = response['data']
         df = []
         for date, details in data.items():
             line = [date]
             [line.append(details[i]) for i in ['min', 'max', 'mean', 'std']]
             df.append(line)
    
         plot_data.append(dict(scale=scale, coverage=coverage, yaxis=yaxis,  vars=['date', 'min', 'max', 'mean', 'std'], data=df))
         update_status(dirname, my_hash, Plot_status.extracting, percentage=90/len(series))

   elif plot_type == "transect":
      for s in series:
         ds = s['data_source']
         yaxis = s['yAxis']
         if yaxis == 1:
            scale = json_request['plot']['y1Axis']['scale']
         else:
            scale = json_request['plot']['y2Axis']['scale']

         coverage = ds['coverage']
         csv_file = json_request['plot']['transectFile']
         wcs_url = ds['threddsUrl']
         bbox = get_transect_bounds(csv_file)
         time = get_transect_times(csv_file)
         data_request = "TransectExtractor('{}',{},extract_area={},extract_variable={})".format(wcs_url, time, bbox, coverage)
         debug(3, "Requesting data: {}".format(data_request))
         extractor = TransectExtractor(wcs_url, [time], "time", extract_area=bbox, extract_variable=coverage)
         filename = extractor.getData()
         debug(4, "Extracted to {}".format(filename))
         stats = TransectStats(filename, coverage, csv_file)
         output_data = stats.process()
         debug(4, "Transect extract: {}".format(output_data))

         #TODO LEGACY - this reformats the response to the new format.
         df = []
         for details in output_data:
            line = []
            [line.append(details[i]) for i in ["data_date", "data_value", "track_date", "track_lat", "track_lon"]]
            #TODO This strips out nulls as the break the plotting at the moment.
            if line[1] != 'null': df.append(line)
    
         #TODO This was in the extractor command line butnot sure we need it at the moment.
         #output_metadata = extractor.metadataBlock()
         #output = {}
         #output['metadata'] = output_metadata
         #output['data'] = output_data

         # And convert it to a nice simple dict the plotter understands.
         plot_data.append(dict(scale=scale, coverage=coverage, yaxis=yaxis, vars=["data_date", "data_value", "track_date", "track_lat", "track_lon"], data=df))
         update_status(dirname, my_hash, Plot_status.extracting, percentage=90/len(series))

   else:
      # We should not be here!
      debug(0, "Unrecognised data request, {}.".format(data_request))
      return dict(data=[])

   plot['status'] = "success"
   plot['data'] = plot_data
   return plot
#END get_plot_data

def prepare_plot(request, outdir):
   '''
   Prepare_plot takes a plot request and hashes it to produce a key for future use.
   It then parses the request to build the calls to the extract service and submits them
   as single result tests to get the timing information.
   If all looks OK it returns the hash to the caller, otherwise it returns an error.
   '''

   # TODO Currently get issues as the JSON is not always in the same order so hash is different.

   hasher = hashlib.sha1()
   hasher.update(json.dumps(request))
   my_hash = "{}".format(hasher.hexdigest())
   my_id = "{}{}".format(int(time.time()), os.getpid())
   plot = dict(
      req_hash= my_hash, 
      req_id= my_id,
      status= dict(status= Plot_status.initialising), 
      dir_name=outdir)
   return plot
#END prepare_plot

def execute_plot(dirname, plot, request):
   debug(3, "Received request: {}".format(request))

   my_hash = plot['req_hash']
   dirname = plot['dir_name']
   my_id = plot['req_id']
   my_fullid = my_hash + "_" + my_id

   status = read_status(dirname, my_hash)
   if status == None or status['state'] == Plot_status.failed:
      
      update_status(dirname, my_hash, Plot_status.initialising, "Preparing")

      # Output the identifier for the plot on stdout. This is used by the frontend
      # to monitor the status of the plot. We must not do this before we have written the 
      # status file.
      print(my_hash)

      # Store the request for possible caching in the future.
      request_path = dirname + "/" + my_hash + "-request.json"
      debug(2, "File: {}".format(request_path))
      with open(request_path, 'w') as outfile:
         json.dump(request, outfile)
      
      # Call the extractor.
      update_status(dirname, my_hash, Plot_status.extracting, "Extracting")
      plot = get_plot_data(request, plot)

      # Only cache the data if we think it is OK.
      if plot['status'] == "success":
         data_path = dirname + "/" + my_hash + "-data.json"
         debug(2, "File: {}".format(data_path))
         with open(data_path, 'w') as outfile:
            json.dump(plot, outfile)

   else:
      # This request has already been made by someone so just point the middleware at the existing status
      # file. The request may be complete, in which case the middleware can pull back the plot, or still
      # in progress. We don't care so just send back the hash so the middleware can monitor it.
      # Do not mess with the status!
      print(my_hash)
      return True
      
   # We are making a plot so decide where to store it.
   file_path = dirname + "/" + my_hash + "-plot.html"

   plot_data = plot['data']

   if len(plot_data) == 0:
      debug(0, "Data request failed")
      update_status(dirname, my_hash, Plot_status.failed, "Extract failed")
      return False

   plot['req_hash'] = my_hash
   plot['req_id'] = my_id
   plot['dir_name'] = dirname

   update_status(dirname, my_hash, Plot_status.plotting, "Plotting")
   if plot['type'] == 'timeseries':
      plot_file = timeseries(plot, file_path)
   elif plot['type'] == 'scatter':
      plot_file = scatter(plot, file_path)
   elif plot['type'] in ("hovmollerLat", "hovmollerLon"):
      plot_file = hovmoller(plot, file_path)
   elif plot['type'] == 'transect':
      plot_file = transect(plot, file_path)
   else:
      # We should not be here.
      debug(0, "Unknown plot type, {}.".format(plot['type']))
      return False

   update_status(opts.dirname, my_hash, Plot_status.complete, "Complete")
   return True
#END execute_plot
   
def read_status(dirname, my_hash):
   '''
      Reads a JSON status file whose name is defined by dirname and my_hash.
   '''

   status = None
   file_path = dirname + "/" + my_hash + "-status.json"
   try:
      with open(file_path, 'r') as status_file:
         status = json.load(status_file)
   except IOError as err:
      if err.errno == 2:
         debug(2, "Status file {} not found".format(file_path))
      else:
         raise

   return status
#END read_status

def update_status(dirname, my_hash, plot_status, message="", percentage=0):
   '''
      Updates a JSON status file whose name is defined by dirname and my_hash.
   '''

   initial_status = dict(
      percentage = 0,
      state = plot_status,
      message = message,
      completed = False,
      job_id = my_hash
   )

   # Read status file, create if not there.
   file_path = dirname + "/" + my_hash + "-status.json"
   try:
      with open(file_path, 'r') as status_file:
         if plot_status == Plot_status.initialising:
            status = initial_status
         else:
            status = json.load(status_file)
   except IOError as err:
      if err.errno == 2:
         debug(2, "Status file {} not found".format(file_path))
         # It does not exist yet so create the initial JSON
         status = initial_status
      else:
         raise

   # Update the status information.
   status["message"] = message
   status["state"] = plot_status
   status['percentage'] = percentage
   if plot_status == Plot_status.complete:
      status["completed"] = True
      status['filename'] = dirname + "/" + my_hash + "-plot.html"
      status['csv'] = dirname + "/" + my_hash + ".zip"
   elif plot_status == Plot_status.failed:
      status["completed"] = True
      status['filename'] = None
      status['csv'] = None
   else:
      status["completed"] = False
      status['filename'] = None
      status['csv'] = None

   debug(3, "Status: {}".format(status))

   # Write it back to the file.
   with open(file_path, 'w') as status_file:
      json.dump(status, status_file)

   return status
#END update_status

def read_cached_request(dirname, my_hash):
   '''
   Looks for a file named <dirname>/<my_hash>-request.json.
   If the file exists the contents are returned otherwise None.
   '''
   request = None
   request_path = dirname + "/" + my_hash + "-request.json"
   try:
      with open(request_path, 'r') as request_file:
         request = json.load(request_file)
   except IOError as err:
      if err.errno == 2:
         debug(2, "Request file {} not found".format(request_path))
      else:
         raise

   return request
#END read_cached_request

def read_cached_data(dirname, my_hash, my_id):
   plot = None
   data_path = dirname + "/" + my_hash + "-data.json"
   try:
      with open(data_path, 'r') as outfile:
         plot = json.load(outfile)
   except IOError as err:
      if err.errno == 2:
         debug(2, "Cache file {} not found".format(data_path))
      else:
         raise

   return plot 
#END read_cached_data

def debug(level, msg):
   if verbosity >= level: print(msg, file=sys.stderr)
#END debug


if __name__ == "__main__":
   from argparse import ArgumentParser, RawTextHelpFormatter
   import os

   usage_text = """Usage: %prog [options]
"""
   description_text = """Plotting functions

Examples:

To execute a plot
./plots.py -c execute -d /tmp < testing/data/testscatter1.json

"""

   valid_commands = ('execute', 'csv')
   cmdParser = ArgumentParser(formatter_class=RawTextHelpFormatter, epilog=description_text)
   cmdParser.add_argument("-c", "--command", action="store", dest="command", default="status", help="Plot command to execute {}.".format(valid_commands))
   cmdParser.add_argument("-v", "--verbose", action="count", dest="verbose", help="Enable verbose output, more v's, more verbose.")
   cmdParser.add_argument("-d", "--dir", action="store", dest="dirname", default="", help="Output directory.")
   cmdParser.add_argument("-H", "--hash", action="store", dest="hash", default="", help="Id of prepared command.")

   opts = cmdParser.parse_args()

   if hasattr(opts, 'verbose') and opts.verbose > 0: verbosity = opts.verbose 

   debug(1, "Verbosity is {}".format(opts.verbose))
   if not os.path.isdir(opts.dirname):
      debug(0,"'{}' is not a directory".format(opts.dirname))
      sys.exit(1)
   
   if opts.command not in valid_commands:
      debug(0,"Command must be one of {}".format(valid_commands))
      sys.exit(1)

   if opts.command == "execute":
      request = json.load(sys.stdin)

      plot = prepare_plot(request, opts.dirname)
      my_hash = plot['req_hash']
      # Now try and make the plot.
      try:
         if execute_plot(opts.dirname, plot, request):
            debug(1, "Plot complete")
         else:
            debug(0, "Failed to complete plot")
            sys.exit(2)
      except:
         update_status(opts.dirname, my_hash, Plot_status.failed, "Extract failed")
         raise

   else:
      # We should not be here
      sys.exit(2)
